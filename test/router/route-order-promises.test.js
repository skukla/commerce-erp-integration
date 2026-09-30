/*
 * Available-to-promise on the order's parts (AB-19): just before each part is sent, its ERP
 * is asked what it can promise, and the answer is recorded on the part for the parts page.
 * Asked BEFORE the send — once the ERP holds the order it counts the order's own quantity
 * against its stock. Never a reason to hold: an ask that fails leaves no promise and the
 * send goes on. Same harness as route-order-split.test.js.
 */
import { resetErpBlocksClient } from "#lib/erp-blocks";
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
const OWNER = { CAB1: "brand-a", CAB2: "brand-a", SIGN1: "brand-b" };
const ORDER = {
  base_currency_code: "USD",
  increment_id: "000000042",
  items: [
    { base_price: 100, item_id: 1, qty_ordered: 1, sku: "CAB1" },
    { base_price: 50, item_id: 2, qty_ordered: 2, sku: "SIGN1" },
    { base_price: 100, item_id: 3, qty_ordered: 1, sku: "CAB2" },
    { item_id: 4, parent_item_id: 3, sku: "CAB2" },
  ],
  store_id: 3,
};
const PROMISE = {
  "brand-a": [
    { canPromiseNow: true, sku: "CAB1" },
    { canPromiseNow: false, promiseDate: "2026-10-07", sku: "CAB2" },
  ],
  "brand-b": [{ canPromiseNow: true, sku: "SIGN1" }],
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

/** The split harness's collaborators, plus the promise ask; each call stamped in order. */
function deps(over = {}) {
  const calls = [];
  let n = 0;
  return {
    addNote: vi.fn(async () => ({})),
    calls,
    erp: {
      createOrder: vi.fn((params) => {
        n += 1;
        calls.push(`send:${params.ERP_BASE_URL}`);
        return Promise.resolve({
          data: { number: `${params.ERP_BASE_URL}#${n}` },
          ok: true,
          status: 201,
        });
      }),
    },
    findOrder: vi.fn(async () => ({ entityId: 41, extOrderId: null, storeId: 3 })),
    logger: { warn: vi.fn() },
    ownsSku: (p, sku, settings) =>
      ownsSku(p, sku, settings, {
        productAttributes: async () =>
          OWNER[sku] ? { erp_owner: OWNER[sku] } : {},
        sourceCodesOf: async () => [],
      }),
    promisesFor: vi.fn(async (_p, erp, lines) => {
      calls.push(`ask:${erp.connection.baseUrl}:${lines.map((l) => l.sku).join("+")}`);
      return PROMISE[erp.id];
    }),
    setExtOrderId: vi.fn(async () => ({})),
    settingsFor: vi.fn(async () => ({ orders_hold_offline: true, orders_send: true })),
    ...over,
  };
}

const stored = (state) =>
  JSON.parse(state.store.get(orderPartsKey("000000042")));

let state;
beforeEach(() => {
  state = memoryState();
  resetOrderPartsClient(state);
  // The one-ERP company path looks the company's blocks up (router/route-order.js).
  resetErpBlocksClient(memoryState());
});

describe("Given a split order and two ERPs", () => {
  test("Then each ERP is asked once, for its own lines, BEFORE its part is sent", async () => {
    const d = deps();
    await routeOrder({}, ORDER, d, ERPS);
    expect(d.calls).toEqual([
      "ask:https://a.example:CAB1+CAB2+CAB2",
      "send:https://a.example",
      "ask:https://b.example:SIGN1",
      "send:https://b.example",
    ]);
  });

  test("Then the answer is recorded on the part, for the parts page to read", async () => {
    const d = deps();
    await routeOrder({}, ORDER, d, ERPS);
    const record = stored(state);
    expect(record.parts["brand-a"].promises).toEqual(PROMISE["brand-a"]);
    expect(record.parts["brand-b"].promises).toEqual(PROMISE["brand-b"]);
    expect(record.parts["brand-a"].status).toBe("sent");
  });

  test("Then an ask that fails leaves no promise, is logged, and the part is still sent", async () => {
    const d = deps({
      promisesFor: vi.fn(async (_p, erp) => {
        if (erp.id === "brand-b") throw new Error("ERP timed out");
        return PROMISE["brand-a"];
      }),
    });
    const result = await routeOrder({}, ORDER, d, ERPS);
    expect(result.outcome).toBe("sent");
    const record = stored(state);
    expect(record.parts["brand-a"].promises).toEqual(PROMISE["brand-a"]);
    expect(record.parts["brand-b"]).not.toHaveProperty("promises");
    expect(record.parts["brand-b"].status).toBe("sent");
    expect(d.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Brand B ERP: availability not asked: ERP timed out"),
    );
  });

  test("Then a router handed no way to ask records no promise and sends as before", async () => {
    const d = deps({ promisesFor: undefined });
    const result = await routeOrder({}, ORDER, d, ERPS);
    expect(result.outcome).toBe("sent");
    expect(stored(state).parts["brand-a"]).not.toHaveProperty("promises");
  });
});

describe("Given a company's order and one ERP", () => {
  test("Then the whole order is asked about before the send, and the promise sits on its one part", async () => {
    const one = [ERPS[0]];
    const d = deps({ companyIdOf: vi.fn(async () => "7") });
    const order = { ...ORDER, customer_id: 5, items: ORDER.items.filter((l) => l.sku !== "SIGN1") };
    // One ERP sends with the deploy's own base URL (lib/erps.js listErps), so name it.
    await routeOrder({ ERP_BASE_URL: "https://a.example" }, order, d, one);
    expect(d.calls[0]).toBe("ask:https://a.example:CAB1+CAB2+CAB2");
    expect(d.calls[1]).toBe("send:https://a.example");
    expect(stored(state).parts["brand-a"].promises).toEqual(PROMISE["brand-a"]);
  });
});
