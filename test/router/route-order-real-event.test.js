/*
 * The order as the event really carries it (2026-09-28, Bodea): the subscription names no
 * `entity_id`, so the router finds the order's id in Commerce before anything needs it. And a
 * part its ERP refuses stays open: failed, so the order is Partially Held and the part can be
 * sent again, never dropped while the other parts go (design v1 §3.3, one ERP down or refusing).
 */
vi.mock("#src/order/commerce-order-api-client", () => ({
  addComment: vi.fn(async () => ({})),
  getOrder: vi.fn(async () => ({ state: "new", status: "pending" })),
  holdOrder: vi.fn(async () => true),
  unholdOrder: vi.fn(async () => true),
}));

import { companyOrders, resetErpBlocksClient, setBlock } from "#lib/erp-blocks";
import { readOrderParts, resetOrderPartsClient } from "#lib/order-parts";
import { ownsSku } from "#lib/structure";
import { routeOrder } from "#router/route-order";
import { addComment, holdOrder } from "#src/order/commerce-order-api-client";

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
const OWNER = { CAB1: "brand-a", SIGN1: "brand-b" };
/** The fields the order subscription asks for (app.commerce.config.ts): no entity_id. */
const EVENT_ORDER = {
  customer_id: 44,
  increment_id: "000000042",
  items: [
    { base_price: 100, item_id: 1, qty_ordered: 1, sku: "CAB1" },
    { base_price: 50, item_id: 2, qty_ordered: 2, sku: "SIGN1" },
  ],
  store_id: 3,
};

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

const TAKEN = { data: { number: "N1" }, ok: true, status: 201 };
const REFUSED = {
  data: { error: "request is invalid" },
  ok: false,
  status: 401,
};

function deps({ brandB = TAKEN, companyId = "7" } = {}) {
  return {
    addNote: vi.fn(async () => ({})),
    companyIdOf: vi.fn(async () => companyId),
    erp: {
      createOrder: vi.fn(async (params) =>
        params.ERP_BASE_URL === "https://b.example" ? brandB : TAKEN,
      ),
    },
    findOrder: vi.fn(async () => ({
      entityId: 55,
      extOrderId: null,
      storeId: 3,
    })),
    logger: { warn: vi.fn() },
    ownsSku: (p, sku, settings) =>
      ownsSku(p, sku, settings, {
        productAttributes: async () =>
          OWNER[sku] ? { erp_owner: OWNER[sku] } : {},
        sourceCodesOf: async () => [],
      }),
    setExtOrderId: vi.fn(async () => ({})),
    settingsFor: vi.fn(async () => ({
      orders_hold_offline: true,
      orders_send: true,
    })),
  };
}

const statusComments = () =>
  addComment.mock.calls
    .map(([, , body]) => body.statusHistory)
    .filter((h) => h.status);

beforeEach(() => {
  vi.clearAllMocks();
  const state = memoryState();
  resetOrderPartsClient(state);
  resetErpBlocksClient(state);
});

describe("Given the order event, which carries no order id", () => {
  test("Then a company's order is remembered by the id Commerce answers", async () => {
    await routeOrder({}, EVENT_ORDER, deps(), ERPS);
    expect(await companyOrders("7")).toEqual([
      { incrementId: "000000042", orderId: 55 },
    ]);
  });

  test("Then with every part taken the status is left alone", async () => {
    await routeOrder({}, EVENT_ORDER, deps(), ERPS);
    expect(statusComments()).toEqual([]);
    expect(holdOrder).not.toHaveBeenCalled();
  });

  test("Then a part held by a block marks the order Partially Held", async () => {
    await setBlock("7", "brand-b", true);
    await routeOrder({}, EVENT_ORDER, deps(), ERPS);
    expect(statusComments()).toEqual([
      expect.objectContaining({ status: "partially_held" }),
    ]);
  });
});

/*
 * The ERP names each line by the Commerce item id it was sent (its customer line reference),
 * and every shipment, invoice, credit memo and return is matched to its Commerce line by it.
 * A line sent without one can never be matched again, so an order event whose lines carry no
 * item ids is completed from Commerce before anything is sent, or not sent at all.
 */
describe("Given an order event whose lines carry no item ids", () => {
  const NO_IDS = {
    ...EVENT_ORDER,
    items: EVENT_ORDER.items.map(({ item_id: _id, ...line }) => line),
  };
  const fromCommerce = {
    entity_id: 55,
    increment_id: "000000042",
    items: [
      { base_price: 100, item_id: 81, qty_ordered: 1, sku: "CAB1" },
      { base_price: 50, item_id: 82, qty_ordered: 2, sku: "SIGN1" },
    ],
  };

  test("Then the lines are read from Commerce by the order's number, each ERP is sent its line's item id, and the part records it", async () => {
    const d = deps({ companyId: null });
    d.getOrder = vi.fn(async () => structuredClone(fromCommerce));
    const result = await routeOrder({ some: "param" }, NO_IDS, d, ERPS);

    expect(result.outcome).toBe("sent");
    expect(d.getOrder).toHaveBeenCalledExactlyOnceWith(
      { some: "param" },
      "000000042",
    );
    const sent = d.erp.createOrder.mock.calls.map(([params, body]) => [
      params.ERP_BASE_URL,
      body.lines.map((l) => [l.sku, l.customerLineReference]),
    ]);
    expect(sent).toEqual([
      ["https://a.example", [["CAB1", "81"]]],
      ["https://b.example", [["SIGN1", "82"]]],
    ]);
    const record = await readOrderParts("000000042");
    expect(record.parts["brand-a"].itemIds).toEqual([81]);
    expect(record.parts["brand-b"].itemIds).toEqual([82]);
  });

  test("Then with one ERP the whole order is sent with its item ids too", async () => {
    const d = deps({ companyId: null });
    d.getOrder = vi.fn(async () => structuredClone(fromCommerce));
    await routeOrder({}, NO_IDS, d, [ERPS[0]]);
    expect(
      d.erp.createOrder.mock.calls[0][1].lines.map(
        (l) => l.customerLineReference,
      ),
    ).toEqual(["81", "82"]);
  });

  test.each([
    ["Commerce cannot find the order yet", async () => null],
    [
      "Commerce's own lines carry no ids either",
      async () => ({ increment_id: "000000042", items: NO_IDS.items }),
    ],
    ["the order cannot be read here at all", undefined],
  ])(
    "Then when %s, nothing is sent to any ERP and the event is held to be delivered again, saying why",
    async (_words, getOrder) => {
      const d = deps({ companyId: null });
      d.getOrder = getOrder;
      const result = await routeOrder({}, NO_IDS, d, ERPS);
      expect(result).toEqual({
        message:
          "order 000000042: its lines carry no Commerce item ids, and they could not be read from Commerce; nothing was sent to any ERP.",
        outcome: "held",
        statusCode: 503,
      });
      expect(d.erp.createOrder).not.toHaveBeenCalled();
      expect((await readOrderParts("000000042")).parts).toEqual({});
    },
  );
});

describe("Given Brand B's ERP refuses its part", () => {
  test("Then Brand A's part is taken, Brand B's stays open as failed, and the order is Partially Held naming it", async () => {
    const result = await routeOrder(
      {},
      EVENT_ORDER,
      deps({ brandB: REFUSED, companyId: null }),
      ERPS,
    );
    const record = await readOrderParts("000000042");
    expect(record.parts["brand-a"].status).toBe("sent");
    expect(record.parts["brand-b"]).toMatchObject({
      refused: true,
      status: "failed",
    });
    const [held] = statusComments();
    expect(held).toMatchObject({ status: "partially_held" });
    expect(held.comment).toContain("brand-b");
    // Delivering the event again cannot change a refusal: Re-send is the way back.
    expect(result.statusCode).toBe(200);
  });
});
