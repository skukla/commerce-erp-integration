/*
 * Each ERP for itself with ONE ERP (owner, 2026-09-28): a company's order is recorded as that
 * ERP's one part; while the ERP blocks the company the order waits On Hold, with the reason in
 * its history, instead of being sent; a guest's order is sent exactly as before.
 */
vi.mock("#lib/order-sync", () => ({
  sendOrderToErp: vi.fn(async () => ({
    erpNumber: "0000001042",
    message: "sent",
    outcome: "sent",
    statusCode: 200,
  })),
}));
vi.mock("#src/order/commerce-order-api-client", () => ({
  getOrder: vi.fn(async () => ({ state: "new" })),
  holdOrder: vi.fn(async () => true),
  unholdOrder: vi.fn(async () => true),
}));

import { companyOrders, resetErpBlocksClient, setBlock } from "#lib/erp-blocks";
import { readOrderParts, resetOrderPartsClient } from "#lib/order-parts";
import { sendOrderToErp } from "#lib/order-sync";
import { routeOrder } from "#router/route-order";
import { holdOrder } from "#src/order/commerce-order-api-client";

const ONE = [{ adapter: "demo-erp", id: "erp", name: "Northwind ERP" }];
const ORDER = {
  customer_id: 44,
  entity_id: 55,
  increment_id: "000000042",
  items: [{ item_id: 1, sku: "CAB1" }],
};

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

const deps = () => ({
  addNote: vi.fn(async () => ({})),
  companyIdOf: vi.fn(async () => "7"),
});

beforeEach(() => {
  resetErpBlocksClient(memoryState());
  resetOrderPartsClient(memoryState());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given one ERP and a company's order", () => {
  test("Then it is sent as before and recorded as the ERP's one part, remembered as the company's open order", async () => {
    const d = deps();
    const result = await routeOrder({}, ORDER, d, ONE);
    expect(result.outcome).toBe("sent");
    expect(sendOrderToErp).toHaveBeenCalledExactlyOnceWith({}, ORDER, d);
    const record = await readOrderParts("000000042");
    expect(record.parts.erp).toMatchObject({
      erpNumber: "0000001042",
      itemIds: [1],
      skus: ["CAB1"],
      status: "sent",
    });
    expect(await companyOrders("7")).toEqual([
      { incrementId: "000000042", orderId: 55 },
    ]);
  });

  test("Then while the ERP blocks the company the order is not sent: it waits On Hold with the reason, and the event is answered as done", async () => {
    await setBlock("7", "erp", true);
    const d = deps();
    const result = await routeOrder({}, ORDER, d, ONE);
    expect(sendOrderToErp).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: "skipped", statusCode: 200 });
    expect((await readOrderParts("000000042")).parts.erp).toMatchObject({
      heldBy: "block",
      status: "held",
    });
    expect(holdOrder).toHaveBeenCalledWith({}, 55);
    expect(d.addNote).toHaveBeenCalledWith(
      {},
      55,
      "Northwind ERP blocks this company; the order waits until it lifts the block.",
    );
  });

  test("Then a guest's order touches no state and is sent exactly as before", async () => {
    const guest = { ...ORDER, customer_id: null };
    const d = deps();
    await routeOrder({}, guest, d, ONE);
    expect(sendOrderToErp).toHaveBeenCalledExactlyOnceWith({}, guest, d);
    expect(await companyOrders("7")).toEqual([]);
  });
});
