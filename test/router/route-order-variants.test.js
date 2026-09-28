/*
 * The router's variant check (Phase B slice B7): a configurable product whose variants belong
 * to different ERPs is a setup mistake. The ordered variant still goes to its own ERP, and the
 * part records a setup warning; the order is never blocked for it.
 */
import { orderPartsKey, resetOrderPartsClient } from "#lib/order-parts";
import { ownsSku } from "#lib/structure";
import { routeOrder } from "#router/route-order";

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

/** A cabinet ordered in red (a configurable's variant) beside a sign. */
const ORDER = {
  base_currency_code: "USD",
  base_grand_total: 200,
  increment_id: "000000077",
  items: [
    {
      base_price: 100,
      item_id: 1,
      product_id: 70,
      product_type: "configurable",
      qty_ordered: 1,
      sku: "CAB-RED",
    },
    { item_id: 2, parent_item_id: 1, product_id: 71, sku: "CAB-RED" },
    { base_price: 100, item_id: 3, qty_ordered: 1, sku: "SIGN1" },
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

function deps(owner, variants) {
  return {
    addNote: vi.fn(async () => ({})),
    erp: {
      createOrder: vi.fn(async (params) => ({
        data: { number: `${params.ERP_BASE_URL}#1` },
        ok: true,
        status: 201,
      })),
    },
    findOrder: vi.fn(async () => ({
      entityId: 41,
      extOrderId: null,
      storeId: 3,
    })),
    logger: { warn: vi.fn() },
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
    variantsOf: vi.fn(variants),
  };
}

let state;
beforeEach(() => {
  state = memoryState();
  resetOrderPartsClient(state);
});

const stored = () => JSON.parse(state.store.get(orderPartsKey("000000077")));

describe("Given an order for a variant of a configurable product, with two ERPs", () => {
  test("Then variants owned by different ERPs record a setup warning on the part, and the order still goes", async () => {
    const d = deps(
      { "CAB-BLUE": "brand-b", "CAB-RED": "brand-a", SIGN1: "brand-b" },
      async () => ({ parentSku: "CAB", skus: ["CAB-RED", "CAB-BLUE"] }),
    );
    const result = await routeOrder({}, ORDER, d, ERPS);

    expect(result.outcome).toBe("sent");
    expect(d.erp.createOrder).toHaveBeenCalledTimes(2);
    expect(d.variantsOf).toHaveBeenCalledWith({}, 70);
    expect(stored().parts["brand-a"]).toMatchObject({
      status: "sent",
      warnings: [
        "CAB's variants belong to different ERPs (brand-a: CAB-RED; brand-b: CAB-BLUE); fix the setup.",
      ],
    });
    expect(stored().parts["brand-b"].warnings).toBeUndefined();
  });

  test("Then variants all owned by one ERP record no warning", async () => {
    const d = deps(
      { "CAB-BLUE": "brand-a", "CAB-RED": "brand-a", SIGN1: "brand-b" },
      async () => ({ parentSku: "CAB", skus: ["CAB-RED", "CAB-BLUE"] }),
    );
    await routeOrder({}, ORDER, d, ERPS);
    expect(stored().parts["brand-a"].warnings).toBeUndefined();
  });

  test("Then a variant check that cannot read the variants is logged, and the order still goes", async () => {
    const d = deps({ "CAB-RED": "brand-a", SIGN1: "brand-b" }, () =>
      Promise.reject(new Error("Commerce is slow")),
    );
    const result = await routeOrder({}, ORDER, d, ERPS);
    expect(result.outcome).toBe("sent");
    expect(stored().parts["brand-a"].warnings).toBeUndefined();
    expect(d.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("variants of CAB-RED not checked"),
    );
  });

  test("Then with one ERP the variants are never read", async () => {
    const d = deps({}, async () => ({ parentSku: "CAB", skus: [] }));
    // Only whether the variants were read matters here, not how the send ended.
    await routeOrder({}, { ...ORDER, increment_id: "000000078" }, d, [
      ERPS[0],
    ]).catch(() => undefined);
    expect(d.variantsOf).not.toHaveBeenCalled();
  });
});
