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
      applied: "Applied",
      dropped: "Not sent",
      failed: "Not applied yet",
      held: "Waiting for the ERP",
      refused: "Refused by Commerce",
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
      historyRow(
        entry("sent", { attempts: 3, retriedBy: "admin" }),
        "Northwind ERP",
      ),
    ).toMatchObject({
      direction: "To Northwind ERP",
      key: "order.42",
      retriable: false,
      retry: { incrementId: "42" },
      tries: "3 tries, the last by an admin",
      what: "Order 42",
    });
    expect(historyRow(entry("held")).tries).toBe("1 try");
  });

  test("Then an unknown result is shown as it is, not hidden", () => {
    expect(historyRow(entry("paused")).result).toBe("paused");
  });

  // The ERP → Commerce half: named for what changed, retried by its event id.
  const erpEvent = (kind, ref, outcome = "failed") =>
    entry(outcome, { direction: "from-erp", eventId: "ev-1", kind, ref });

  test.each([
    ["price", "ABC", "SKU ABC"],
    ["stock", "ABC", "SKU ABC"],
    ["order-status", "42", "Order 42"],
    ["shipment", "42", "Order 42"],
    ["credit", "7", "Company 7"],
    ["block", "7", "Company 7"],
  ])(
    "Then a %s event from the ERP is named for what it changed",
    (kind, ref, what) => {
      expect(historyRow(erpEvent(kind, ref), "Northwind ERP")).toMatchObject({
        direction: "From Northwind ERP",
        key: "erp.ev-1",
        what,
      });
    },
  );

  test("Then an ERP event that did not get through is retried by its event id", () => {
    expect(historyRow(erpEvent("credit", "7", "failed"))).toMatchObject({
      retriable: true,
      retry: { eventId: "ev-1" },
    });
    expect(canRetry(erpEvent("credit", "7", "refused"))).toBe(true);
    expect(canRetry(erpEvent("credit", "7", "applied"))).toBe(false);
  });
});
