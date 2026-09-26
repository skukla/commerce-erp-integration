/*
 * erp/order-grid: Commerce POSTs the visible orders' numbers ({ requestId, gridType, ids })
 * and renders what comes back in the ERP's column (Admin UI SDK V2, order grid columns;
 * shape from Adobe's v2 sample and @adobe/aio-commerce-lib-admin-ui's grid-columns types).
 */
vi.mock("#lib/history", () => ({
  readRecord: vi.fn(async (key) =>
    key === "order.000000012"
      ? { erpNumber: "NORT-0000001042", outcome: "sent" }
      : undefined,
  ),
}));

import { readRecord } from "#lib/history";
import { main } from "#src/erp/order-grid/index";

afterEach(() => vi.clearAllMocks());

describe("Given the orders grid asking for the ERP column", () => {
  test("Then each order this ERP knows gets its cell, keyed by the column id, and nothing else", async () => {
    const res = await main({
      gridType: "order",
      ids: ["000000012", "000000013"],
      requestId: "r1",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toStrictEqual({
      "000000012": { erp_integration_order: "NORT-0000001042 · Sent" },
    });
    expect(readRecord).toHaveBeenCalledWith("order.000000012");
    expect(readRecord).toHaveBeenCalledWith("order.000000013");
  });

  test("Then a request with no order ids is refused in words", async () => {
    const res = await main({ gridType: "order", ids: [], requestId: "r2" });

    expect(res.error.statusCode).toBe(400);
  });
});
