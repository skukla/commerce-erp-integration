/*
 * An order's parts as staff read them (design v1 §3.3): the "ERP parts" cell on the Sales >
 * Orders grid, and the rows of the order's parts page. Read from the router's parts record
 * (lib/order-parts.js record shape).
 */
import { orderPartsPage, partRows, partsSummary } from "#lib/order-parts-view";

const ERPS = [
  { id: "brand-a", name: "Brand A ERP" },
  { id: "brand-b", name: "Brand B ERP" },
];

describe("Given an order's parts record, the grid's ERP parts cell", () => {
  test("Then every part sent reads as a count of the whole", () => {
    expect(
      partsSummary({
        parts: { "brand-a": { status: "sent" }, "brand-b": { status: "sent" } },
      }),
    ).toBe("2 of 2 sent");
  });

  test("Then a part still going counts against the sent", () => {
    expect(
      partsSummary({
        parts: {
          "brand-a": { status: "sent" },
          "brand-b": { status: "sending" },
        },
      }),
    ).toBe("1 of 2 sent");
  });

  test("Then waiting parts are named by what holds them, ahead of the count", () => {
    expect(
      partsSummary({
        parts: {
          "brand-a": { status: "sent" },
          "brand-b": { status: "held" },
          "brand-c": { status: "failed" },
        },
      }),
    ).toBe("1 held, 1 failed");
    expect(
      partsSummary({ parts: { "brand-b": { status: "cancelled" } } }),
    ).toBe("1 cancelled");
  });

  test("Then lines that reached no ERP, or two, are counted too", () => {
    expect(
      partsSummary({
        conflicts: [{ erps: ["brand-a", "brand-b"], sku: "X" }],
        parts: { "brand-a": { status: "sent" } },
        unrouted: ["Y", "Z"],
      }),
    ).toBe("1 of 1 sent, 2 lines with no ERP, 1 line claimed twice");
  });

  test("Then an order with no parts has no cell", () => {
    expect(partsSummary({ parts: {} })).toBeUndefined();
    expect(partsSummary(undefined)).toBeUndefined();
  });
});

describe("Given an order's parts record, the parts page's rows", () => {
  const record = {
    parts: {
      "brand-a": {
        erpNumber: "A-1042",
        itemIds: [1, 3, 4],
        message: "sent",
        // What the ERP promised just before the send (router/route-order.js, AB-19).
        promises: [
          { canPromiseNow: true, sku: "CAB1" },
          { canPromiseNow: false, promiseDate: "2026-10-07", sku: "CAB2" },
        ],
        skus: ["CAB1", "CAB2"],
        status: "sent",
      },
      "brand-b": {
        heldBy: "block",
        itemIds: [2],
        message: "Brand B ERP blocks this company.",
        skus: ["SIGN1"],
        status: "held",
        warnings: ["SIGN1's variants belong to two ERPs"],
      },
    },
  };

  test("Then each part names its ERP, lines, status and number, and only a waiting one can be re-sent", () => {
    expect(partRows(record, ERPS)).toStrictEqual([
      {
        canResend: false,
        erpId: "brand-a",
        erpName: "Brand A ERP",
        erpNumber: "A-1042",
        promised: "1 of 2 lines ship now; CAB2 by 2026-10-07",
        skus: ["CAB1", "CAB2"],
        status: "sent",
        waitsFor: null,
        warnings: [],
      },
      {
        canResend: true,
        erpId: "brand-b",
        erpName: "Brand B ERP",
        erpNumber: null,
        promised: null,
        skus: ["SIGN1"],
        status: "held",
        waitsFor: "Brand B ERP blocks this company.",
        warnings: ["SIGN1's variants belong to two ERPs"],
      },
    ]);
  });

  test("Then a failed part can be re-sent; a cancelled one cannot, and says why it waits", () => {
    const rows = partRows(
      {
        parts: {
          "brand-a": { message: "ERP down", status: "failed" },
          "brand-b": { message: "cancelled in the ERP", status: "cancelled" },
        },
      },
      ERPS,
    );
    expect(rows.map((r) => [r.canResend, r.waitsFor])).toStrictEqual([
      [true, "ERP down"],
      [false, "cancelled in the ERP"],
    ]);
  });

  test("Then a part whose ERP left the list keeps its id as its name", () => {
    const [row] = partRows({ parts: { gone: { status: "sent" } } }, ERPS);
    expect(row.erpName).toBe("gone");
  });
});

describe("Given an order's page of parts", () => {
  test("Then a routed order shows its parts, its summary and the lines that reached no ERP", () => {
    const page = orderPartsPage({
      erps: ERPS,
      record: {
        conflicts: [{ erps: ["brand-a", "brand-b"], sku: "X" }],
        parts: { "brand-a": { status: "sent" } },
        unrouted: ["Y"],
      },
    });
    expect(page).toMatchObject({
      conflicts: [{ erps: ["brand-a", "brand-b"], sku: "X" }],
      summary: "1 of 1 sent, 1 line with no ERP, 1 line claimed twice",
      unrouted: ["Y"],
    });
    expect(page.rows.map((r) => r.erpId)).toEqual(["brand-a"]);
  });

  test("Then with one ERP an order the router kept no parts for is one part, from the order's history", () => {
    const page = orderPartsPage({
      erps: [{ id: "erp", name: "Northwind ERP" }],
      history: { erpNumber: "N-9", message: "ERP down", outcome: "failed" },
      record: { parts: {} },
    });
    expect(page.rows).toStrictEqual([
      {
        canResend: true,
        erpId: "erp",
        erpName: "Northwind ERP",
        erpNumber: "N-9",
        promised: null,
        skus: [],
        status: "failed",
        waitsFor: "ERP down",
        warnings: [],
        wholeOrder: true,
      },
    ]);
    expect(page.summary).toBe("1 failed");
  });

  test("Then an order no ERP has seen has no parts", () => {
    expect(
      orderPartsPage({ erps: ERPS, record: { parts: {} } }).rows,
    ).toStrictEqual([]);
  });
});
