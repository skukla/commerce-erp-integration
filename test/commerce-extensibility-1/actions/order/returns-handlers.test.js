/*
 * The three actions returns and credit memos run through (returns-design.md, slices D to F):
 * each hands its event to the router and answers I/O Events by the outcome — 200 applied,
 * 400 refused (not delivered again), 503 busy or waiting (delivered again), 500 failed.
 */
vi.mock("#router/credit-memos", () => ({ creditMemoFromErp: vi.fn() }));
vi.mock("#router/return-received", () => ({ returnReceivedFromErp: vi.fn() }));
vi.mock("#router/return-pieces", () => ({ returnToErps: vi.fn() }));
vi.mock("#lib/history", () => ({
  readRecord: vi.fn(),
  recordCommerceChange: vi.fn(async () => undefined),
  updateRecord: vi.fn(async () => undefined),
}));

import { recordCommerceChange, updateRecord } from "#lib/history";
import { creditMemoFromErp } from "#router/credit-memos";
import { returnToErps } from "#router/return-pieces";
import { returnReceivedFromErp } from "#router/return-received";
import * as returnSaved from "#src/order/commerce/return-saved/index";
import * as creditMemoCreated from "#src/order/external/creditmemo-created/index";
import * as returnUpdated from "#src/order/external/return-updated/index";

const statusOf = (res) => res.statusCode ?? res.error?.statusCode;

/** The history row the wrapper recorded (lib/erp-event-history.js). */
function recorded() {
  const [[key, build]] = updateRecord.mock.calls;
  return { key, ...build(undefined, "now") };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the ERP's credit memo event", () => {
  const params = {
    data: {
      creditMemoNumber: "9500000001",
      incrementId: "5000000002",
      orderId: 31,
    },
    id: "ev-1",
    type: "be-observer.sales_order_creditmemo_create",
  };

  test("Then the order's credit memo is made and the event answered applied, recorded as a credit memo", async () => {
    creditMemoFromErp.mockResolvedValue({ matched: true, message: "done" });

    const res = await creditMemoCreated.main(params);

    expect(statusOf(res)).toBe(200);
    expect(creditMemoFromErp).toHaveBeenCalledExactlyOnceWith(
      params,
      31,
      params.data,
    );
    expect(recorded()).toMatchObject({
      key: "erp.ev-1",
      kind: "credit-memo",
      message: "order 5000000002: credited (credit memo 9500000001)",
      outcome: "applied",
      ref: "5000000002",
    });
  });

  test.each([
    [{ busy: true, reason: "busy" }, 503],
    [{ matched: false, reason: "not its line" }, 400],
  ])("Then %o answers %i", async (outcome, status) => {
    creditMemoFromErp.mockResolvedValue(outcome);

    const res = await creditMemoCreated.main(params);

    expect(statusOf(res)).toBe(status);
    expect(res.error.body.message).toBe(outcome.reason);
  });

  test("Then an event with no order is refused, and a failure answers 500", async () => {
    expect(statusOf(await creditMemoCreated.main({ data: {} }))).toBe(400);
    creditMemoFromErp.mockRejectedValue(new Error("Commerce answered 500"));
    expect(statusOf(await creditMemoCreated.main(params))).toBe(500);
  });
});

describe("Given the ERP's return received event", () => {
  const params = {
    data: {
      commerceReturnId: 4,
      incrementId: "5000000002",
      orderId: 31,
      returnNumber: "RB-1",
    },
    id: "ev-2",
    type: "be-observer.rma_status_update",
  };

  test("Then it is applied and recorded as a return", async () => {
    returnReceivedFromErp.mockResolvedValue({ matched: true, message: "ok" });

    const res = await returnUpdated.main(params);

    expect(statusOf(res)).toBe(200);
    expect(returnReceivedFromErp).toHaveBeenCalledExactlyOnceWith(
      params,
      params.data,
    );
    expect(recorded()).toMatchObject({
      kind: "return",
      message: "order 5000000002: return order RB-1 received",
      ref: "5000000002",
    });
  });

  test.each([
    [{ busy: true, reason: "busy" }, 503],
    [{ matched: false, reason: "no such return" }, 400],
  ])("Then %o answers %i", async (outcome, status) => {
    returnReceivedFromErp.mockResolvedValue(outcome);

    expect(statusOf(await returnUpdated.main(params))).toBe(status);
  });

  test("Then a failure answers 500", async () => {
    returnReceivedFromErp.mockRejectedValue(new Error("boom"));

    expect(statusOf(await returnUpdated.main(params))).toBe(500);
  });
});

describe("Given Commerce saved a return", () => {
  test.each([
    [{ entity_id: 4, increment_id: "000000004" }],
    [{ id: "4", increment_id: "000000004" }],
  ])("Then the return %o is sent to its ERPs, by its id", async (value) => {
    const result = { message: "sent", outcome: "sent", statusCode: 200 };
    returnToErps.mockResolvedValue(result);
    const params = { data: { value }, id: "ev-3" };

    const res = await returnSaved.main(params);

    expect(statusOf(res)).toBe(200);
    expect(returnToErps).toHaveBeenCalledExactlyOnceWith(params, 4);
    expect(recordCommerceChange).toHaveBeenCalledWith(
      "returned",
      value,
      result,
      expect.anything(),
    );
  });

  test.each([
    ["held", 503],
    ["dropped", 400],
    ["skipped", 200],
  ])("Then an outcome %s answers %i", async (outcome, status) => {
    returnToErps.mockResolvedValue({
      message: "m",
      outcome,
      statusCode: status,
    });

    expect(
      statusOf(await returnSaved.main({ data: { value: { entity_id: 4 } } })),
    ).toBe(status);
  });

  test("Then an event with no return id is refused, and a failure answers 500", async () => {
    expect(statusOf(await returnSaved.main({ data: { value: {} } }))).toBe(400);
    returnToErps.mockRejectedValue(new Error("boom"));
    expect(
      statusOf(await returnSaved.main({ data: { value: { entity_id: 4 } } })),
    ).toBe(500);
  });
});
