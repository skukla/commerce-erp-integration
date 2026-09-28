/*
 * What the Admin page says about each ERP with several ERPs: the header's line per ERP (whether
 * the integration can use it, and why not), and the Overview's row of figures per ERP.
 */
import { erpStatusLine, overviewRows } from "#web/overview-view.js";

describe("Given the ERPs the page header lists", () => {
  test("Then a reachable ERP reads as connected", () => {
    expect(
      erpStatusLine({ id: "erp", name: "Northwind ERP", reachable: true }),
    ).toStrictEqual({ reachable: true, text: "Connected to Northwind ERP" });
  });

  test.each([
    [
      "Contoso ERP is in maintenance until 15:55 UTC.",
      "Contoso ERP is not reachable. Contoso ERP is in maintenance until 15:55 UTC.",
    ],
    [
      "the ERP answered 401",
      "Contoso ERP is not reachable. The ERP answered 401.",
    ],
    ["fetch failed", "Contoso ERP is not reachable. Fetch failed."],
  ])("Then an ERP that cannot be used says why (%s)", (error, text) => {
    expect(
      erpStatusLine({
        error,
        id: "contoso",
        name: "Contoso ERP",
        reachable: false,
      }),
    ).toStrictEqual({ reachable: false, text });
  });

  test("Then an ERP that cannot be used and gives no reason still says so", () => {
    expect(
      erpStatusLine({ id: "contoso", name: "Contoso ERP", reachable: false })
        .text,
    ).toBe("Contoso ERP is not reachable.");
  });
});

describe("Given the Overview with several ERPs", () => {
  test("Then each ERP is a row with its own figures, and a dash where it gave none", () => {
    expect(
      overviewRows(
        [
          {
            counts: {
              businessPartners: 12,
              events: 0,
              products: 120,
              salesOrders: 4,
            },
            id: "erp",
            lastImportAt: "2026-09-28T09:00:00Z",
            name: "Northwind ERP",
            reachable: true,
          },
          {
            error: "the ERP answered 401",
            id: "contoso",
            name: "Contoso ERP",
            reachable: false,
          },
        ],
        (iso) => `[${iso}]`,
      ),
    ).toStrictEqual([
      {
        businessPartners: 12,
        events: 0,
        id: "erp",
        lastImportAt: "[2026-09-28T09:00:00Z]",
        lastWipeAt: "never",
        name: "Northwind ERP",
        products: 120,
        salesOrders: 4,
        state: "Reachable",
      },
      {
        businessPartners: "–",
        events: "–",
        id: "contoso",
        lastImportAt: "never",
        lastWipeAt: "never",
        name: "Contoso ERP",
        products: "–",
        salesOrders: "–",
        state: "Not reachable. The ERP answered 401.",
      },
    ]);
  });
});
