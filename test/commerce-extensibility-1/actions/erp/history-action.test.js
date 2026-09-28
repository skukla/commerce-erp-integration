/* The history action: what the Commerce Admin screen lists, and its Retry of one order. */
vi.mock("#lib/history", () => ({
  readHistory: vi.fn(async () => []),
  recordOrderOutcome: vi.fn(),
}));
vi.mock("#lib/order-sync", () => ({ retryOrderToErp: vi.fn() }));
vi.mock("#lib/erp-event-history", () => ({
  HANDLER_ACTIONS: { credit: "company-backoffice/credit-updated" },
  readErpEvent: vi.fn(),
}));
const mockInvoke = vi.fn(async () => ({ statusCode: 200 }));
vi.mock("openwhisk", () => ({
  default: () => ({ actions: { invoke: mockInvoke } }),
}));
vi.mock("#lib/scheduled-runs", () => ({
  readScheduledRuns: vi.fn(async () => [
    { id: "prices", lastRun: { at: "T" } },
  ]),
}));
// Company events are named when the history is read (lib/history-names.js).
vi.mock("#lib/key-map", () => ({
  commerceCompanyOf: vi.fn(async (partnerId) =>
    partnerId === "100042" ? "4" : null,
  ),
}));
vi.mock("#lib/commerce", () => ({
  getCompany: vi.fn(async (_params, id) => ({
    company_name: "Kukla Studios",
    id: Number(id),
  })),
  getOrderByIncrementId: vi.fn(),
}));
vi.mock("#lib/order-deps", () => ({
  orderSyncDeps: vi.fn((logger) => ({ logger, marker: "real deps" })),
}));

import { getCompany } from "#lib/commerce";
import { readErpEvent } from "#lib/erp-event-history";
import { readHistory, recordOrderOutcome } from "#lib/history";
import { retryOrderToErp } from "#lib/order-sync";
import { main } from "#src/erp/history/index";

const HELD = {
  attempts: 3,
  direction: "to-erp",
  kind: "order",
  message: "order 42 is waiting for the ERP.",
  outcome: "held",
  ref: "42",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the history action", () => {
  test("Then GET ?scheduled=true answers the scheduled runs, and no history", async () => {
    const res = await main({ __ow_method: "get", scheduled: "true" });
    expect(res.body).toStrictEqual({
      scheduled: [{ id: "prices", lastRun: { at: "T" } }],
    });
    expect(readHistory).not.toHaveBeenCalled();
  });

  test("Then GET lists the history, newest first, with the screen's filters", async () => {
    readHistory.mockResolvedValueOnce([HELD]);

    const res = await main({
      __ow_method: "get",
      failedOnly: "true",
      ref: "42",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toStrictEqual({ entries: [HELD] });
    expect(readHistory).toHaveBeenCalledWith({ failedOnly: true, ref: "42" });
  });

  test("Then GET names the Commerce company an ERP customer's event is about, each company read once", async () => {
    const credit = {
      direction: "from-erp",
      event: { data: { creditLimit: 25_000, partnerId: "100042" } },
      eventId: "ev-1",
      kind: "credit",
      message: "customer 100042: credit limit 25000",
      outcome: "applied",
      ref: "100042",
    };
    readHistory.mockResolvedValueOnce([
      credit,
      { ...credit, eventId: "ev-2" },
      HELD,
    ]);

    const res = await main({ __ow_method: "get" });

    expect(res.body.entries.map((e) => e.company)).toStrictEqual([
      { id: "4", name: "Kukla Studios" },
      { id: "4", name: "Kukla Studios" },
      undefined,
    ]);
    expect(getCompany).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      "4",
    );
  });

  test("Then POST retries one order, records it as an admin's retry, and answers its record", async () => {
    const result = {
      message: "order 42 is ERP sales order 5.",
      outcome: "sent",
      statusCode: 200,
    };
    retryOrderToErp.mockResolvedValueOnce(result);
    const sent = { ...HELD, outcome: "sent", retriedBy: "admin" };
    readHistory.mockResolvedValueOnce([sent]);
    const params = {
      __ow_body: JSON.stringify({ incrementId: "42" }),
      __ow_method: "post",
    };

    const res = await main(params);

    expect(res.statusCode).toBe(200);
    expect(res.body).toStrictEqual({
      entry: sent,
      message: result.message,
      outcome: "sent",
    });
    const [passed, incrementId, deps] = retryOrderToErp.mock.calls[0];
    expect(passed).toBe(params);
    expect(incrementId).toBe("42");
    expect(deps.marker).toBe("real deps");
    expect(recordOrderOutcome).toHaveBeenCalledWith(
      { increment_id: "42" },
      result,
      expect.objectContaining({ retriedBy: "admin" }),
    );
  });

  test("Then a retry that did not get through is still an answer, not an error", async () => {
    retryOrderToErp.mockResolvedValueOnce({
      message: "order 42 is waiting for the ERP.",
      outcome: "held",
      statusCode: 503,
    });

    const res = await main({
      __ow_body: JSON.stringify({ incrementId: "42" }),
      __ow_method: "post",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.outcome).toBe("held");
  });

  test.each([
    ["no order number", {}],
    [
      "an order number with characters an order number never has",
      { incrementId: "42; DROP" },
    ],
  ])("Then %s is refused, and nothing is sent", async (_, body) => {
    const res = await main({
      __ow_body: JSON.stringify(body),
      __ow_method: "post",
    });

    expect(res.error.statusCode).toBe(400);
    expect(retryOrderToErp).not.toHaveBeenCalled();
  });

  // An ERP event that could not be applied: the same handler, handed the saved event.
  test("Then POST with an event id hands the saved event to its handler again, as an admin's retry", async () => {
    const saved = {
      event: {
        data: { companyId: 7, creditLimit: 5000 },
        type: "be-observer.company_credit_update",
      },
      eventId: "ev-1",
      kind: "credit",
      outcome: "failed",
    };
    readErpEvent.mockResolvedValueOnce(saved).mockResolvedValueOnce({
      ...saved,
      outcome: "applied",
      retriedBy: "admin",
    });

    const res = await main({
      __ow_body: JSON.stringify({ eventId: "ev-1" }),
      __ow_method: "post",
    });

    expect(mockInvoke).toHaveBeenCalledWith({
      blocking: true,
      name: "company-backoffice/credit-updated",
      params: {
        __retriedBy: "admin",
        data: saved.event.data,
        id: "ev-1",
        type: saved.event.type,
      },
      result: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.entry).toMatchObject({
      outcome: "applied",
      retriedBy: "admin",
    });
  });

  test("Then an event id the history does not have is refused, and nothing runs", async () => {
    readErpEvent.mockResolvedValueOnce(undefined);

    const res = await main({
      __ow_body: JSON.stringify({ eventId: "gone" }),
      __ow_method: "post",
    });

    expect(res.error.statusCode).toBe(404);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
