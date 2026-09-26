vi.mock("#lib/erp", () => ({ erp: { importRecords: vi.fn() } }));
vi.mock("#lib/commerce", () => ({
  productAttributes: vi.fn(async () => ({})),
  skuForProductId: vi.fn(),
  sourceCodesOf: vi.fn(async () => []),
}));

import { skuForProductId } from "#lib/commerce";
import { erp } from "#lib/erp";
import { sendData } from "#src/stock/commerce/updated/sender";
import { transformData } from "#src/stock/commerce/updated/transformer";
import { validateData } from "#src/stock/commerce/updated/validator";

describe("Given the stock event chain", () => {
  test("Then the quantity reaches the ERP under the product's SKU", async () => {
    const transformed = transformData({
      value: { product_id: 12, qty: "7.0" },
    });
    expect(transformed).toEqual({ productId: 12, stock: 7 });
    skuForProductId.mockResolvedValue("W1");
    erp.importRecords.mockResolvedValue({ data: {}, ok: true, status: 200 });
    expect(await sendData({}, transformed)).toEqual({ success: true });
    expect(erp.importRecords).toHaveBeenCalledWith(
      {},
      {
        origin: {
          event: "observer.cataloginventory_stock_item_save_commit_after",
        },
        products: [{ sku: "W1", stock: 7 }],
      },
    );
  });
  test("Then an unknown product is a 404 and a missing qty is invalid", async () => {
    skuForProductId.mockResolvedValue(null);
    expect((await sendData({}, { productId: 99, stock: 1 })).statusCode).toBe(
      404,
    );
    expect(validateData({ value: { product_id: 1 } }).success).toBe(false);
    expect(validateData({ value: { product_id: 1, qty: 3 } }).success).toBe(
      true,
    );
  });
});
