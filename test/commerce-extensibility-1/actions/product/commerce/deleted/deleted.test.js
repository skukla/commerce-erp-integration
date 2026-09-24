vi.mock("#lib/erp", () => ({
  erp: { deleteProduct: vi.fn() },
}));

import { erp } from "#lib/erp";
import * as deleted from "#src/product/commerce/deleted/index";

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given a product deleted in Commerce", () => {
  test("Then the ERP is told to remove it, naming the event for its journal", async () => {
    erp.deleteProduct.mockResolvedValueOnce({
      data: { sku: "A1", unlinked: [] },
      ok: true,
      status: 200,
    });
    const res = await deleted.main({
      data: { value: { id: 9, sku: "A1" } },
      id: "evt-1",
    });
    expect(res.statusCode).toBe(200);
    expect(erp.deleteProduct).toHaveBeenCalledWith(expect.anything(), "A1", {
      origin: {
        event: "observer.catalog_product_delete_commit_after",
        eventId: "evt-1",
      },
    });
  });
  test("Then a SKU the ERP never had is nothing to do, not a failure; a refusal is one; no sku is refused", async () => {
    erp.deleteProduct.mockResolvedValueOnce({
      data: {},
      ok: false,
      status: 404,
    });
    expect((await deleted.main({ data: { sku: "ZZ" } })).statusCode).toBe(200);
    erp.deleteProduct.mockResolvedValueOnce({
      data: { errorMessage: "down" },
      ok: false,
      status: 503,
    });
    expect((await deleted.main({ data: { sku: "A1" } })).error.statusCode).toBe(
      500,
    );
    expect((await deleted.main({ data: { value: {} } })).error.statusCode).toBe(
      400,
    );
    expect(erp.deleteProduct).toHaveBeenCalledTimes(2);
  });
});
