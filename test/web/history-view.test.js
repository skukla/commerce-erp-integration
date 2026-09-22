/* What the Admin screen's History section says about each record, and when it offers Retry. */
import { canRetry, historyRow, RESULT } from "#web/history-view.js";

const entry = (outcome, extra = {}) => ({
  attempts: 1,
  direction: "to-erp",
  firstAt: "2026-09-22T10:00:00.000Z",
  kind: "order",
  lastAt: "2026-09-22T10:08:00.000Z",
  message: `order 42 ${outcome}`,
  outcome,
  ref: "42",
  ...extra,
});

describe("Given the History section", () => {
  test.each([
    ["sent", RESULT.sent],
    ["held", RESULT.held],
    ["dropped", RESULT.dropped],
  ])("Then a %s order reads as the merchant would say it", (outcome, label) => {
    expect(historyRow(entry(outcome)).result).toBe(label);
  });

  test("Then the words are plain", () => {
    expect(RESULT).toStrictEqual({
      dropped: "Not sent",
      held: "Waiting for the ERP",
      sent: "Sent",
    });
  });

  // Held orders are retried by I/O Events for a day; a person need not wait for that.
  test("Then Retry is offered for an order that did not get through, and only then", () => {
    expect(canRetry(entry("held"))).toBe(true);
    expect(canRetry(entry("dropped"))).toBe(true);
    expect(canRetry(entry("sent"))).toBe(false);
  });

  test("Then a row names the order, how many tries it took, and who retried it", () => {
    expect(
      historyRow(entry("sent", { attempts: 3, retriedBy: "admin" })),
    ).toMatchObject({
      key: "order.42",
      order: "42",
      retriable: false,
      tries: "3 tries, the last by an admin",
    });
    expect(historyRow(entry("held")).tries).toBe("1 try");
  });

  test("Then an unknown result is shown as it is, not hidden", () => {
    expect(historyRow(entry("paused")).result).toBe("paused");
  });
});
