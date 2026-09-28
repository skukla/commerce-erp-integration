/*
 * Blocks per brand at routing time (design v1 §3.1): a new order's part for an ERP that
 * blocks the buyer's company waits (held by the block) instead of being sent; the other ERPs'
 * parts go. The order is remembered as the company's open order so the unblock can send it.
 */
import { companyOrders, resetErpBlocksClient, setBlock } from "#lib/erp-blocks";
import { readOrderParts, resetOrderPartsClient } from "#lib/order-parts";
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
const OWNER = { CAB1: "brand-a", SIGN1: "brand-b" };
const ORDER = {
  customer_id: 44,
  entity_id: 55,
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

function deps() {
  return {
    addNote: vi.fn(async () => ({})),
    companyIdOf: vi.fn(async () => "7"),
    erp: {
      createOrder: vi.fn(async () => ({
        data: { number: "N1" },
        ok: true,
        status: 201,
      })),
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

beforeEach(() => {
  const state = memoryState();
  resetOrderPartsClient(state);
  resetErpBlocksClient(state);
});

describe("Given Brand B's ERP blocks the buyer's company", () => {
  test("Then Brand A's part is sent, Brand B's part waits held by the block, and the delivery is not retried for it", async () => {
    await setBlock("7", "brand-b", true);
    const d = deps();
    const result = await routeOrder({}, ORDER, d, ERPS);
    expect(d.erp.createOrder).toHaveBeenCalledTimes(1);
    expect(d.erp.createOrder.mock.calls[0][0].ERP_BASE_URL).toBe(
      "https://a.example",
    );
    const record = await readOrderParts("000000042");
    expect(record.companyId).toBe("7");
    expect(record.parts["brand-b"]).toMatchObject({
      heldBy: "block",
      status: "held",
    });
    expect(result.statusCode).toBe(200);
    expect(await companyOrders("7")).toEqual([
      { incrementId: "000000042", orderId: 55 },
    ]);
  });

  test("Then with no block both parts are sent and the order is still remembered for the company", async () => {
    const d = deps();
    await routeOrder({}, ORDER, d, ERPS);
    expect(d.erp.createOrder).toHaveBeenCalledTimes(2);
    expect(await companyOrders("7")).toHaveLength(1);
  });
});
