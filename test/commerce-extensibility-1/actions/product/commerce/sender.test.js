vi.mock("#lib/erp", () => ({ erp: { importRecords: vi.fn() } }));

import { erp } from "#lib/erp";
import { sendData } from "#src/product/commerce/updated/sender";
import { transformData } from "#src/product/commerce/updated/transformer";
import { validateData } from "#src/product/commerce/updated/validator";

describe("Given the product event chain", () => {
  test("Then a product becomes one product row and is imported", async () => {
    const rows = transformData({
      value: { name: "Widget", price: "12.5", sku: "W1" },
    });
    expect(rows).toEqual({
      products: [{ listPrice: 12.5, name: "Widget", sku: "W1" }],
    });
    erp.importRecords.mockResolvedValue({ data: {}, ok: true, status: 200 });
    expect(await sendData({}, rows)).toEqual({ success: true });
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
