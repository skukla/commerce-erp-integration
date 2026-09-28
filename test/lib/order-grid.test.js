/*
 * The cell the Sales > Orders grid shows in this ERP's column: the ERP's number and where the
 * send stands, from the integration's own order history (lib/history.js record shapes).
 */
import { orderGridCell, partsNumbersCell } from "#lib/order-grid";

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

/*
 * Several ERPs: a split order has no one ERP number (no one part writes ext_order_id), and the
 * column is labelled with the first ERP's name, so the cell names each part's ERP with its
 * number, or where its part stands (the router's parts record, lib/order-parts.js).
 */
describe("Given several ERPs and an order's parts", () => {
  const ERPS = [
    { id: "erp", name: "Northwind ERP" },
    { id: "contoso", name: "Contoso ERP" },
  ];

  test("Then a split order shows each ERP's number, and says the part still waiting", () => {
    expect(
      partsNumbersCell(
        {
          parts: {
            contoso: { status: "held" },
            erp: { erpNumber: "0000001000", status: "sent" },
          },
        },
        ERPS,
      ),
    ).toBe("Split: Northwind ERP 0000001000; Contoso ERP waiting");
  });

  test("Then an order wholly one ERP's names that ERP with its number", () => {
    expect(
      partsNumbersCell(
        { parts: { contoso: { erpNumber: "0000002000", status: "sent" } } },
        ERPS,
      ),
    ).toBe("Contoso ERP 0000002000");
  });

  test.each([
    ["failed", "Contoso ERP not sent"],
    ["sending", "Contoso ERP sending"],
    ["cancelled", "Contoso ERP cancelled"],
  ])("Then a %s part says where it stands", (status, cell) => {
    expect(partsNumbersCell({ parts: { contoso: { status } } }, ERPS)).toBe(
      cell,
    );
  });

  test("Then an order with no parts has no parts cell", () => {
    expect(partsNumbersCell({ parts: {} }, ERPS)).toBeUndefined();
    expect(partsNumbersCell(undefined, ERPS)).toBeUndefined();
  });
});
