vi.mock("#lib/erp", () => ({ erp: { importRecords: vi.fn() } }));
vi.mock("#lib/commerce", () => ({
  productAttributes: vi.fn(async () => ({})),
  sourceCodesOf: vi.fn(async () => []),
  warehousesOfSku: vi.fn(async () => [
    { code: "northwind", name: "Northwind Warehouse", quantity: 994 },
    { code: "east", name: "East Warehouse", quantity: 25 },
  ]),
}));

import { erp } from "#lib/erp";
import { sendData } from "#src/product/commerce/updated/sender";
import { transformData } from "#src/product/commerce/updated/transformer";
import { validateData } from "#src/product/commerce/updated/validator";

describe("Given the product event chain", () => {
  test("Then a product becomes one product row and is imported", async () => {
    const rows = transformData({
      value: { name: "Widget", price: "12.5", sku: "W1" },
    });
    // What arrived, in the ERP's words, rides along so the ERP's log can say so.
    expect(rows).toEqual({
      origin: { document: "product W1", system: "Adobe Commerce" },
      products: [{ listPrice: 12.5, name: "Widget", sku: "W1" }],
    });
    erp.importRecords.mockResolvedValue({ data: {}, ok: true, status: 200 });
    expect(await sendData({}, rows)).toEqual({ success: true });
    // A save on the product page is how a person changes stock at any location, and
    // Commerce raises no event of its own for a location (2026-09-27): so the product's
    // stock at every location goes with it.
    expect(erp.importRecords).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({
        products: [{ listPrice: 12.5, name: "Widget", sku: "W1" }],
        stock: [
          {
            sku: "W1",
            warehouses: [
              { code: "northwind", name: "Northwind Warehouse", quantity: 994 },
              { code: "east", name: "East Warehouse", quantity: 25 },
            ],
          },
        ],
      }),
    );
    erp.importRecords.mockResolvedValue({
      data: { errorMessage: "offline" },
      ok: false,
      status: 503,
    });
    expect(await sendData({}, rows)).toEqual({
      message: "offline",
      statusCode: 503,
      success: false,
    });
  });
  test("Then an event without a sku is invalid", () => {
    expect(validateData({ value: {} }).success).toBe(false);
    expect(validateData({ value: { sku: "A" } }).success).toBe(true);
  });
});
