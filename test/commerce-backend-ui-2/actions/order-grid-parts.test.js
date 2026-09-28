/*
 * admin-ui/order-grid, the second column: "ERP parts", read from the router's parts record
 * (lib/order-parts.js), beside the ERP's own column. An order the router never split into
 * parts gets no parts cell; a parts record that cannot be read leaves the ERP's column alone.
 */
vi.mock("#lib/history", () => ({
  readRecord: vi.fn(async (key) =>
    key === "order.000000012"
      ? { erpNumber: "0000001042", outcome: "sent" }
      : undefined,
  ),
}));
vi.mock("#lib/order-parts", () => ({
  readOrderParts: vi.fn((incrementId) => {
    if (incrementId === "000000013") {
      return Promise.resolve({
        conflicts: [],
        parts: {
          "brand-a": { status: "sent" },
          "brand-b": { status: "held" },
        },
        unrouted: [],
      });
    }
    if (incrementId === "000000014") {
      return Promise.reject(new Error("State is down"));
    }
    return Promise.resolve({ conflicts: [], parts: {}, unrouted: [] });
  }),
}));

import appConfig from "#app.commerce.config";
import { main } from "#web-actions/order-grid/index.js";

const [ERP_COLUMN, PARTS_COLUMN] =
  appConfig.adminUi.order.gridColumns.columns.map((c) => c.id);

afterEach(() => vi.clearAllMocks());

describe("Given the orders grid asking for the ERP parts column", () => {
  test("Then the app declares the column, labelled ERP parts", () => {
    expect(appConfig.adminUi.order.gridColumns.columns[1]).toMatchObject({
      id: "erp_integration_parts",
      label: "ERP parts",
      type: "string",
    });
  });

  test("Then a split order gets its parts cell, and an order the router never split gets none", async () => {
    const res = await main({
      gridType: "order",
      ids: ["000000012", "000000013"],
      requestId: "r1",
    });

    expect(res.body.data).toStrictEqual({
      "000000012": { [ERP_COLUMN]: "0000001042 · Sent" },
      "000000013": { [PARTS_COLUMN]: "1 held" },
    });
  });

  test("Then a parts record that cannot be read costs only that cell", async () => {
    const res = await main({
      gridType: "order",
      ids: ["000000012", "000000014"],
      requestId: "r2",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toStrictEqual({
      "000000012": { [ERP_COLUMN]: "0000001042 · Sent" },
    });
  });
});
