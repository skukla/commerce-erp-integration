/* The order save event's action: what each outcome tells I/O Events. */
vi.mock("#lib/order-sync", () => ({ sendOrderToErp: vi.fn() }));
vi.mock("#lib/settings", () => ({ settingsFor: vi.fn() }));
vi.mock("#lib/history", () => ({ recordOrderOutcome: vi.fn() }));
vi.mock("#lib/commerce", () => ({
  findOrderByIncrementId: vi.fn(),
  getOrderByIncrementId: vi.fn(),
  orders: { comment: vi.fn() },
  setExtOrderId: vi.fn(),
}));

import { findOrderByIncrementId, orders, setExtOrderId } from "#lib/commerce";
import { erp } from "#lib/erp";
import { recordOrderOutcome } from "#lib/history";
import { sendOrderToErp } from "#lib/order-sync";
import { settingsFor } from "#lib/settings";
import { main } from "#src/order/commerce/created/index";

const outcome = (name, statusCode) => ({
  message: `${name} message`,
  outcome: name,
  statusCode,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the order created event action", () => {
  test("Then the event's order and the real collaborators are handed to the sync", async () => {
    sendOrderToErp.mockResolvedValueOnce(outcome("sent", 200));
    const params = { data: { value: { increment_id: "1" } } };
    const res = await main(params);
    expect(res.statusCode).toBe(200);
    const [passedParams, order, deps] = sendOrderToErp.mock.calls[0];
    expect(passedParams).toBe(params);
    expect(order).toStrictEqual({ increment_id: "1" });
    expect(deps.erp).toBe(erp);
    expect(deps.findOrder).toBe(findOrderByIncrementId);
    expect(deps.setExtOrderId).toBe(setExtOrderId);
    expect(deps.settingsFor).toBe(settingsFor);
    await deps.addNote(params, 41, "note");
    expect(orders.comment).toHaveBeenCalledWith(params, 41, "note");
  });

  test("Then a skipped order is a success, so it is not delivered again", async () => {
    sendOrderToErp.mockResolvedValueOnce(outcome("skipped", 200));
    expect((await main({ data: { value: {} } })).statusCode).toBe(200);
  });

  test("Then a held order answers 503, which I/O Events delivers again", async () => {
    sendOrderToErp.mockResolvedValueOnce(outcome("held", 503));
    const res = await main({ data: { value: {} } });
    expect(res.error.statusCode).toBe(503);
    expect(JSON.stringify(res.error.body)).toContain("held message");
  });

  test("Then a dropped order answers 400, which ends the delivery", async () => {
    sendOrderToErp.mockResolvedValueOnce(outcome("dropped", 400));
    expect((await main({ data: { value: {} } })).error.statusCode).toBe(400);
  });

  // The history on the Commerce Admin screen: every answer, with the event's order.
  test("Then the outcome is recorded against the event's order", async () => {
    const result = outcome("held", 503);
    sendOrderToErp.mockResolvedValueOnce(result);
    await main({ data: { value: { increment_id: "1" } } });
    expect(recordOrderOutcome).toHaveBeenCalledWith(
      { increment_id: "1" },
      result,
      expect.objectContaining({ logger: expect.anything() }),
    );
  });

  test("Then Commerce being unreachable answers 500, which I/O Events delivers again", async () => {
    sendOrderToErp.mockRejectedValueOnce(new Error("Commerce answered 502"));
    const res = await main({ data: { value: {} } });
    expect(res.error.statusCode).toBe(500);
  });
});
