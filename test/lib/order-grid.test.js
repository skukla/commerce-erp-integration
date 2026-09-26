/*
 * The cell the Sales > Orders grid shows in this ERP's column: the ERP's number and where the
 * send stands, from the integration's own order history (lib/history.js record shapes).
 */
import { orderGridCell } from "#lib/order-grid";

describe("Given an order's history record", () => {
  test("Then a sent order shows the ERP's number and Sent", () => {
    expect(
      orderGridCell({ erpNumber: "NORT-0000001042", outcome: "sent" }),
    ).toBe("NORT-0000001042 · Sent");
  });

  test("Then a send still under way says so", () => {
    expect(orderGridCell({ outcome: "sending" })).toBe("Sending");
  });

  test("Then a failed write-back keeps the number the ERP made, and says it is not through", () => {
    expect(
      orderGridCell({ erpNumber: "NORT-0000001043", outcome: "failed" }),
    ).toBe("NORT-0000001043 · Not sent");
  });

  test("Then an order waiting for the ERP says Waiting", () => {
    expect(orderGridCell({ outcome: "held" })).toBe("Waiting for the ERP");
  });

  test("Then an order this ERP never saw has no cell", () => {
    expect(orderGridCell(undefined)).toBeUndefined();
  });

  test("Then an outcome with no wording shows as it is, rather than nothing", () => {
    expect(orderGridCell({ outcome: "mystery" })).toBe("mystery");
  });
});
