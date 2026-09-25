/* GET ?trace=<order>: one order's whole life, gathered from the three sides that hold it. */
vi.mock("#lib/history", () => ({
  readHistory: vi.fn(async () => []),
  recordOrderOutcome: vi.fn(),
}));
vi.mock("#lib/order-sync", () => ({ retryOrderToErp: vi.fn() }));
vi.mock("#lib/erp-event-history", () => ({
  HANDLER_ACTIONS: {},
  readErpEvent: vi.fn(),
}));
vi.mock("#lib/order-deps", () => ({ orderSyncDeps: vi.fn(() => ({})) }));
vi.mock("#lib/commerce", () => ({ getOrderByIncrementId: vi.fn() }));
vi.mock("#lib/erp", () => ({
  erp: { order: vi.fn(), ordersByReference: vi.fn() },
}));

import { getOrderByIncrementId } from "#lib/commerce";
import { erp } from "#lib/erp";
import { readHistory } from "#lib/history";
import { main } from "#src/erp/history/index";

const COMMERCE_ORDER = {
  created_at: "2026-09-20T09:00:00Z",
  ext_order_id: "0000001042",
  increment_id: "000000042",
  status: "processing",
};

afterEach(() => vi.clearAllMocks());

describe("Given a request to follow one order", () => {
  test("Then it answers the order's steps, from Commerce, the history and the ERP", async () => {
    getOrderByIncrementId.mockResolvedValue(COMMERCE_ORDER);
    readHistory.mockResolvedValue([
      {
        attempts: 1,
        direction: "to-erp",
        kind: "order",
        lastAt: "2026-09-20T09:00:25Z",
        message: "order 000000042 is ERP sales order 0000001042.",
        outcome: "sent",
        ref: "000000042",
      },
    ]);
    erp.order.mockResolvedValue({
      data: {
        history: [{ at: "2026-09-20T09:00:30Z", status: "created" }],
        number: "0000001042",
        status: "created",
      },
      ok: true,
    });

    const res = await main({
      __ow_method: "get",
      ERP_DISPLAY_NAME: "Northwind ERP",
      trace: "000000042",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.trace.summary).toMatchObject({
      erpNumber: "0000001042",
      incrementId: "000000042",
      reachedErp: true,
    });
    expect(res.body.trace.steps.map((s) => s.where)).toStrictEqual([
      "commerce",
      "integration",
      "erp",
    ]);
    expect(readHistory).toHaveBeenCalledWith({ ref: "000000042" });
    expect(erp.order).toHaveBeenCalledWith(
      expect.anything(),
      "0000001042",
      expect.any(Number),
    );
  });

  // The ERP is not asked when nothing says it has the order: no number, no call.
  test("Then an order the ERP never took is answered without asking it", async () => {
    getOrderByIncrementId.mockResolvedValue({
      ...COMMERCE_ORDER,
      ext_order_id: null,
    });
    readHistory.mockResolvedValue([]);

    const res = await main({ __ow_method: "get", trace: "000000042" });

    expect(res.body.trace.summary.reachedErp).toBe(false);
    expect(erp.order).not.toHaveBeenCalled();
  });

  test("Then an ERP that cannot be reached still answers the Commerce half", async () => {
    getOrderByIncrementId.mockResolvedValue(COMMERCE_ORDER);
    readHistory.mockResolvedValue([]);
    erp.order.mockResolvedValue({ ok: false, status: 503 });

    const res = await main({ __ow_method: "get", trace: "000000042" });

    expect(res.statusCode).toBe(200);
    expect(res.body.trace.summary).toMatchObject({ reachedErp: false });
    expect(res.body.trace.steps).toHaveLength(1);
  });

  test("Then an order number Commerce does not have says so", async () => {
    getOrderByIncrementId.mockResolvedValue(null);
    readHistory.mockResolvedValue([]);

    const res = await main({ __ow_method: "get", trace: "no-such" });

    expect(res.statusCode).toBe(200);
    expect(res.body.trace.summary.incrementId).toBeNull();
    expect(res.body.trace.steps).toStrictEqual([]);
  });

  test("Then an order number with characters an order never has is refused", async () => {
    const res = await main({ __ow_method: "get", trace: "42; DROP" });

    expect(res.error.statusCode).toBe(400);
    expect(getOrderByIncrementId).not.toHaveBeenCalled();
  });

  // D7 (2026-09-25): a slow Commerce read used to blank the whole trace, ERP half included.
  test("Then a Commerce that does not answer still yields the ERP half, found by reference", async () => {
    getOrderByIncrementId.mockRejectedValue(new Error("Request timed out"));
    readHistory.mockResolvedValue([]);
    erp.ordersByReference.mockResolvedValue({
      data: { items: [{ number: "0000001042" }] },
      ok: true,
    });
    erp.order.mockResolvedValue({
      data: {
        history: [{ at: "2026-09-20T09:00:30Z", status: "created" }],
        number: "0000001042",
        status: "created",
      },
      ok: true,
    });

    const res = await main({ __ow_method: "get", trace: "000000042" });

    expect(erp.ordersByReference).toHaveBeenCalledWith(
      expect.anything(),
      "000000042",
      expect.any(Number),
    );
    expect(erp.order).toHaveBeenCalledWith(
      expect.anything(),
      "0000001042",
      expect.any(Number),
    );
    expect(res.body.trace.summary).toMatchObject({
      commerceAnswered: false,
      erpNumber: "0000001042",
      incrementId: "000000042",
      reachedErp: true,
    });
  });

  test("Then an order Commerce simply does not have is not looked up in the ERP", async () => {
    getOrderByIncrementId.mockResolvedValue(null);
    readHistory.mockResolvedValue([]);

    await main({ __ow_method: "get", trace: "no-such" });

    expect(erp.ordersByReference).not.toHaveBeenCalled();
  });
});
