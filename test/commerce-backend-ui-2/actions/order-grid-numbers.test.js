/*
 * admin-ui/order-grid with several ERPs, the ERP-number column: a split order has no single
 * ERP number, so the column shows each part's ERP with its number from the router's parts
 * record. Before, it showed whatever number the order's history record held, under the first
 * ERP's name, which for a split order was one part's number or none.
 */
vi.mock("#lib/history", () => ({
  readRecord: vi.fn(async (key) =>
    key === "order.3000000022"
      ? { erpNumber: "0000002000", outcome: "held" }
      : { erpNumber: "0000001042", outcome: "sent" },
  ),
}));
vi.mock("#lib/order-parts", () => ({
  readOrderParts: vi.fn((incrementId) =>
    Promise.resolve(
      incrementId === "3000000022"
        ? {
            conflicts: [],
            parts: {
              contoso: { erpNumber: "0000002000", status: "sent" },
              erp: { status: "held" },
            },
            unrouted: [],
          }
        : { conflicts: [], parts: {}, unrouted: [] },
    ),
  ),
}));
vi.mock("#lib/erps", () => ({
  loadErps: vi.fn(async () => [
    { id: "erp", name: "Northwind ERP" },
    { id: "contoso", name: "Contoso ERP" },
  ]),
}));

import appConfig from "#app.commerce.config";
import { loadErps } from "#lib/erps";
import { main } from "#web-actions/order-grid/index.js";

const [ERP_COLUMN, PARTS_COLUMN] =
  appConfig.adminUi.order.gridColumns.columns.map((c) => c.id);

const grid = async (ids) =>
  (await main({ gridType: "order", ids, requestId: "r1" })).body.data;

describe("Given two ERPs", () => {
  test("Then a split order's ERP column names each ERP's number, in list order", async () => {
    expect(await grid(["3000000022"])).toStrictEqual({
      3000000022: {
        [ERP_COLUMN]: "Split: Northwind ERP waiting; Contoso ERP 0000002000",
        [PARTS_COLUMN]: "1 held",
      },
    });
  });

  test("Then an order with no parts record keeps its history cell", async () => {
    expect(await grid(["000000012"])).toStrictEqual({
      "000000012": { [ERP_COLUMN]: "0000001042 · Sent" },
    });
  });

  test("Then an ERP list that cannot be read costs only the names: the history cell stays", async () => {
    loadErps.mockRejectedValueOnce(new Error("State is down"));
    expect((await grid(["3000000022"]))["3000000022"][ERP_COLUMN]).toBe(
      "0000002000 · Waiting for the ERP",
    );
  });
});
