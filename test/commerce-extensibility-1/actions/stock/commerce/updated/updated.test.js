/*
 * The stock handler driven the way Runtime drives it: `main` gets the event as params, with
 * the stock item under `data.value`. The chain's own tests handed the check the whole event,
 * so they passed while every real event failed with "the stock event carries no product_id"
 * (two failed runs on the Bodea sandbox, 2026-09-26, after an ERP rename saved a product).
 */
vi.mock("#lib/erp", () => ({ erp: { importRecords: vi.fn() } }));
vi.mock("#lib/commerce", () => ({
  productAttributes: vi.fn(async () => ({})),
  skuForProductId: vi.fn(async () => "smartcable"),
  sourceCodesOf: vi.fn(async () => []),
}));
vi.mock("#lib/settings", () => ({ settingsFor: vi.fn(async () => ({})) }));
vi.mock("#lib/structure", () => ({ ownsSku: vi.fn(async () => true) }));

import { erp } from "#lib/erp";
import { main } from "#src/stock/commerce/updated/index";

/** The fields the subscription asks for: item_id, product_id, qty, is_in_stock. */
const EVENT = {
  data: {
    value: { is_in_stock: true, item_id: 41, product_id: 57, qty: "1000.0000" },
  },
  type: "com.adobe.commerce.observer.cataloginventory_stock_item_save_commit_after",
};

afterEach(() => vi.clearAllMocks());

describe("Given a stock event as Runtime delivers it", () => {
  test("Then the quantity reaches the ERP under the product's SKU", async () => {
    erp.importRecords.mockResolvedValue({ data: {}, ok: true, status: 200 });

    const response = await main(EVENT);

    expect(response.statusCode).toBe(200);
    expect(erp.importRecords).toHaveBeenCalledWith(
      EVENT,
      expect.objectContaining({
        products: [{ sku: "smartcable", stock: 1000 }],
      }),
    );
  });

  test("Then an event with no product id is refused and nothing is sent", async () => {
    const response = await main({ data: { value: { item_id: 41, qty: "3" } } });

    expect(response.error.statusCode).toBe(400);
    expect(response.error.body.message).toBe(
      "the stock event carries no product_id",
    );
    expect(erp.importRecords).not.toHaveBeenCalled();
  });
});
