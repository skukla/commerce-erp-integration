/*
 * The router, Phase B slice B1: with several ERPs, each order line goes to the ERP that owns
 * its product, and each ERP is sent its part once. Ownership is the ERP's own setting, read
 * through the one ownership rule the integration has (lib/structure.js); by default a product
 * belongs to the ERP whose id its `erp_owner` attribute holds (design v1 §2, §3.2).
 */
import { orderPartsKey, resetOrderPartsClient } from "#lib/order-parts";
import { OWNS, ownsSku } from "#lib/structure";
import { routeOrder, splitLines } from "#router/route-order";

/** Two ERPs of the demo kind, each owning the products whose erp_owner names it. */
const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "brand-a",
    name: "Brand A ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "brand-b",
    name: "Brand B ERP",
  },
];

/** Which ERP each SKU names in its erp_owner attribute. */
const OWNER = { CAB1: "brand-a", CAB2: "brand-a", SIGN1: "brand-b" };

const ORDER = {
  base_currency_code: "USD",
  base_grand_total: 300,
  increment_id: "000000042",
  items: [
    { base_price: 100, item_id: 1, qty_ordered: 1, sku: "CAB1" },
    { base_price: 50, item_id: 2, qty_ordered: 2, sku: "SIGN1" },
    { base_price: 100, item_id: 3, qty_ordered: 1, sku: "CAB2" },
    { item_id: 4, parent_item_id: 3, sku: "CAB2" },
  ],
  store_id: 3,
};

function memoryState() {
  const store = new Map();
  return {
    get: vi.fn(async (k) =>
      store.has(k) ? { value: store.get(k) } : undefined,
    ),
    put: vi.fn(async (k, v) => store.set(k, v)),
    store,
  };
}

function deps(owner = OWNER) {
  let n = 0;
  return {
    addNote: vi.fn(async () => ({})),
    erp: {
      createOrder: vi.fn((params) => {
        n += 1;
        return Promise.resolve({
          data: { number: `${params.ERP_BASE_URL}#${n}` },
          ok: true,
          status: 201,
        });
      }),
    },
    findOrder: vi.fn(async () => ({
      entityId: 41,
      extOrderId: null,
      storeId: 3,
    })),
    logger: { warn: vi.fn() },
    // The real ownership rule, over a fake product read.
    ownsSku: (p, sku, settings) =>
      ownsSku(p, sku, settings, {
        productAttributes: async () =>
          owner[sku] ? { erp_owner: owner[sku] } : {},
        sourceCodesOf: async () => [],
      }),
    setExtOrderId: vi.fn(async () => ({})),
    settingsFor: vi.fn(async () => ({
      orders_hold_offline: true,
      orders_send: true,
    })),
  };
}

const sentLines = (d) =>
  d.erp.createOrder.mock.calls.map(([params, body]) => ({
    erp: params.ERP_BASE_URL,
    skus: body.lines.map((l) => l.sku),
  }));

let state;
beforeEach(() => {
  state = memoryState();
  resetOrderPartsClient(state);
});

describe("Given a mixed order and two ERPs", () => {
  test("Then it splits into one part per owning ERP, each holding only its lines, each sent once", async () => {
    const d = deps();
    const result = await routeOrder({}, ORDER, d, ERPS);

    expect(sentLines(d)).toEqual([
      { erp: "https://a.example", skus: ["CAB1", "CAB2"] },
      { erp: "https://b.example", skus: ["SIGN1"] },
    ]);
    expect(result.outcome).toBe("sent");
    const stored = JSON.parse(state.store.get(orderPartsKey("000000042")));
    expect(stored.parts["brand-a"]).toMatchObject({
      skus: ["CAB1", "CAB2"],
      status: "sent",
    });
    expect(stored.parts["brand-b"]).toMatchObject({
      skus: ["SIGN1"],
      status: "sent",
    });
  });

  test("Then the ERP number is not written onto the Commerce order by any one part (the router decides that in B2)", async () => {
    const d = deps();
    await routeOrder({}, ORDER, d, ERPS);
    expect(d.setExtOrderId).not.toHaveBeenCalled();
  });

  test("Then a redelivered order event sends nothing new", async () => {
    const d = deps();
    await routeOrder({}, ORDER, d, ERPS);
    const again = await routeOrder({}, ORDER, d, ERPS);
    expect(d.erp.createOrder).toHaveBeenCalledTimes(2);
    expect(again.outcome).toBe("skipped");
  });

  test("Then a part the ERP could not take is sent again on redelivery, and the part already sent is not", async () => {
    const d = deps();
    d.erp.createOrder
      .mockResolvedValueOnce({ data: { number: "A-1" }, ok: true, status: 201 })
      .mockResolvedValueOnce({
        data: { errorMessage: "offline" },
        ok: false,
        status: 503,
      });
    const first = await routeOrder({}, ORDER, d, ERPS);
    expect(first).toMatchObject({ outcome: "held", statusCode: 503 });

    await routeOrder({}, ORDER, d, ERPS);
    expect(sentLines(d).map((s) => s.erp)).toEqual([
      "https://a.example",
      "https://b.example",
      "https://b.example",
    ]);
  });
});

describe("Given lines no ERP or two ERPs claim", () => {
  test("Then a line no ERP owns is held back and recorded, and the rest are sent", async () => {
    const d = deps({ CAB1: "brand-a", CAB2: "brand-a" });
    const result = await routeOrder({}, ORDER, d, ERPS);
    expect(sentLines(d)).toEqual([
      { erp: "https://a.example", skus: ["CAB1", "CAB2"] },
    ]);
    expect(
      JSON.parse(state.store.get(orderPartsKey("000000042"))).unrouted,
    ).toEqual(["SIGN1"]);
    expect(result.message).toContain("SIGN1 belongs to no ERP");
  });

  test("Then a SKU two ERPs claim is a setup error, recorded and sent to neither", async () => {
    const d = deps();
    const claimAll = ERPS.map((e) => ({
      ...e,
      settings: { structure_owns: OWNS.ALL },
    }));
    const result = await routeOrder({}, ORDER, d, claimAll);
    expect(d.erp.createOrder).not.toHaveBeenCalled();
    const stored = JSON.parse(state.store.get(orderPartsKey("000000042")));
    expect(stored.conflicts).toEqual([
      { erps: ["brand-a", "brand-b"], sku: "CAB1" },
      { erps: ["brand-a", "brand-b"], sku: "SIGN1" },
      { erps: ["brand-a", "brand-b"], sku: "CAB2" },
    ]);
    expect(result.outcome).toBe("dropped");
  });
});

describe("Given an order not yet saved (the placement check's payload)", () => {
  // Before Commerce saves the order its lines carry no item_id (measured 2026-10-02 on
  // Justrite: the placement check sent a Justrite cabinet AND an Accuform sign to Accuform
  // alone, because every line keyed to the same missing id and the last owner won).
  const UNSAVED = {
    items: [
      { base_price: 100, qty_ordered: 1, sku: "CAB1" },
      { base_price: 50, qty_ordered: 2, sku: "SIGN1" },
    ],
  };
  const readOwner = (p, sku, settings) =>
    ownsSku(p, sku, settings, {
      productAttributes: async (_p, s) => ({ erp_owner: OWNER[s] }),
      sourceCodesOf: async () => [],
    });

  test("Then each line still goes to the ERP that owns it", async () => {
    const { byErp } = await splitLines({}, UNSAVED, ERPS, {
      ownsSku: readOwner,
    });
    expect([...byErp.keys()]).toEqual(["brand-a", "brand-b"]);
    expect(byErp.get("brand-a").map((l) => l.sku)).toEqual(["CAB1"]);
    expect(byErp.get("brand-b").map((l) => l.sku)).toEqual(["SIGN1"]);
  });
});
