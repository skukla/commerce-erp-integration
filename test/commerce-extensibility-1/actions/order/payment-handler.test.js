/*
 * The action the ERP's payment event runs (AB-26s, contract v14): it hands the event to the
 * router and answers I/O Events by the outcome — 200 applied, 400 refused (not delivered
 * again), 503 busy (delivered again), 500 failed — and records it for the Admin history as a
 * payment.
 */
vi.mock("#router/payments", () => ({ paymentFromErp: vi.fn() }));
vi.mock("#lib/history", () => ({
  readRecord: vi.fn(),
  updateRecord: vi.fn(async () => undefined),
}));

import { updateRecord } from "#lib/history";
import { paymentFromErp } from "#router/payments";
import * as paymentReceived from "#src/order/external/payment-received/index";

const statusOf = (res) => res.statusCode ?? res.error?.statusCode;

/** The history row the wrapper recorded (lib/erp-event-history.js). */
function recorded() {
  const [[key, build]] = updateRecord.mock.calls;
  return { key, ...build(undefined, "now") };
}

afterEach(() => {
  vi.clearAllMocks();
});

const params = {
  data: {
    amount: 42.5,
    incrementId: "5000000002",
    orderId: 31,
    paymentNumber: "7000000001",
  },
  id: "ev-7",
  type: "be-observer.sales_order_payment_create",
};

describe("Given the ERP's payment event", () => {
  test("Then the payment is applied, answered 200, and recorded as a payment", async () => {
    paymentFromErp.mockResolvedValue({ matched: true, message: "done" });

    const res = await paymentReceived.main(params);

    expect(statusOf(res)).toBe(200);
    expect(paymentFromErp).toHaveBeenCalledExactlyOnceWith(
      params,
      31,
      params.data,
    );
    expect(recorded()).toMatchObject({
      key: "erp.ev-7",
      kind: "payment",
      message: "order 5000000002: paid (payment 7000000001, 42.5)",
      outcome: "applied",
      ref: "5000000002",
    });
  });

  test.each([
    [{ busy: true, reason: "busy" }, 503],
    [{ matched: false, reason: "no part for that ERP" }, 400],
  ])("Then %o answers %i", async (outcome, status) => {
    paymentFromErp.mockResolvedValue(outcome);

    const res = await paymentReceived.main(params);

    expect(statusOf(res)).toBe(status);
    expect(res.error.body.message).toBe(outcome.reason);
  });

  test("Then an event with no order is refused, and a failure answers 500", async () => {
    expect(statusOf(await paymentReceived.main({ data: {} }))).toBe(400);
    paymentFromErp.mockRejectedValue(new Error("Commerce answered 500"));
    expect(statusOf(await paymentReceived.main(params))).toBe(500);
  });
});
