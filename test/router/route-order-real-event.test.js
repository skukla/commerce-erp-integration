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
