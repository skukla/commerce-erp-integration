/*
 * The ERP half of a store-scoped close (lib/close-store-orders.js): which ERPs are asked to remove
 * their sales orders, and how an ERP that cannot is named. The whole journey, with the real mock
 * ERP, is test/box/close-store-orders.test.js.
 */
// biome-ignore-all lint/suspicious/useAwait: the fakes answer promises without waiting on anything; the real collaborators are async
import { closeStoreOrders } from "#lib/close-store-orders";

const ERPS = [
  { connection: { baseUrl: "https://a.example" }, id: "erp", name: "A" },
  { connection: { baseUrl: "https://b.example" }, id: "b", name: "B" },
];

/** One already-closed order, its parts record as given; the close only forgets it. */
function depsFor(parts, removeOrders) {
  return {
    commerce: {
      clearExtOrderId: vi.fn(async () => ({})),
      orders: {
        get: vi.fn(async () => ({
          entity_id: 1,
          ext_order_id: "ERP-0000001000",
          increment_id: "000000001",
          items: [],
          state: "closed",
        })),
      },
    },
    erp: { removeOrders: vi.fn(removeOrders) },
    erps: ERPS,
    orderClient: { listOrderReturns: vi.fn(async () => []) },
    orderParts: {
      deleteOrderParts: vi.fn(async () => true),
      markClosedByReset: vi.fn(async () => undefined),
      readOrderParts: vi.fn(async () => ({ parts })),
    },
    storeScope: { orderIdsInViews: vi.fn(async () => ["1"]) },
    today: () => "2026-10-30",
  };
}

const removed = {
  data: { references: { notFound: [] }, removed: { salesOrders: 1 } },
  ok: true,
  status: 200,
};
const close = (deps) =>
  closeStoreOrders({}, { stores: ["s"], websites: [] }, [1], deps);

describe("Given the ERPs of the orders a store close touched", () => {
  test("Then only the ERPs the parts record names are asked, at their own address, before the record is forgotten", async () => {
    const deps = depsFor({ b: { erpNumber: "2" } }, async () => removed);
    const result = await close(deps);
    expect(deps.erp.removeOrders).toHaveBeenCalledTimes(1);
    const [params, references] = deps.erp.removeOrders.mock.calls[0];
    expect(params.ERP_BASE_URL).toBe("https://b.example");
    expect(references).toEqual(["000000001"]);
    expect(result.erpRemoved).toEqual({
      b: { notFound: [], removed: { salesOrders: 1 } },
    });
    const [read] = deps.orderParts.readOrderParts.mock.invocationCallOrder;
    const [forgot] = deps.orderParts.deleteOrderParts.mock.invocationCallOrder;
    expect(read).toBeLessThan(forgot);
  });

  test("Then an order with an ERP number and no parts record is asked of every listed ERP", async () => {
    const deps = depsFor({}, async () => removed);
    const result = await close(deps);
    expect(Object.keys(result.erpRemoved)).toEqual(["erp", "b"]);
  });

  test("Then an ERP that refuses or cannot be reached is named with why, and the close still answers", async () => {
    const refused = await close(
      depsFor({ erp: {} }, async () => ({ data: {}, ok: false, status: 503 })),
    );
    expect(refused.erpRemoved).toEqual({
      erp: { failed: "the ERP answered 503" },
    });
    const down = await close(
      depsFor({ erp: {} }, async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(down.erpRemoved).toEqual({ erp: { failed: "fetch failed" } });
    expect(down.closed.alreadyClosed).toBe(1);
  });

  test("Then a parts record naming an ERP no longer listed is named, not asked", async () => {
    const deps = depsFor({ gone: {} }, async () => removed);
    const result = await close(deps);
    expect(deps.erp.removeOrders).not.toHaveBeenCalled();
    expect(result.erpRemoved).toEqual({
      gone: { failed: "no ERP gone in the list" },
    });
  });
});
