/*
 * A product created or updated in Commerce, and a stock item saved there, go to the ERP that owns
 * the product (AB-16h): the owner by the routing ownership rule (router/ownership.js), at its own
 * address and signed with its own credential. Before, they went to the first ERP whatever owned
 * the product.
 */
vi.mock("@adobe/aio-commerce-sdk/auth", async (original) =>
  (await import("../../lib/per-erp-harness.js")).mintPerClient(original),
);
vi.mock("#lib/commerce", () => ({
  productAttributes: vi.fn(async (_params, sku) =>
    sku === "ORPHAN"
      ? {}
      : { erp_owner: sku.startsWith("C") ? "contoso" : "erp" },
  ),
  skuForProductId: vi.fn(async (_params, id) => (id === 7 ? "C7" : "N8")),
  sourceCodesOf: vi.fn(async () => []),
  warehousesOfSku: vi.fn(async () => [{ code: "main", quantity: 3 }]),
  websiteCodesOf: vi.fn(async () => []),
}));
vi.mock("#lib/settings", () => ({ settingsFor: vi.fn(async () => ({})) }));

import { resetErpTokenCache } from "#lib/erp";
import { resetErpsClient } from "#lib/erps";
import { sendData as productCreated } from "#src/product/commerce/created/sender";
import { sendData as productUpdated } from "#src/product/commerce/updated/sender";
import { sendData as stockSaved } from "#src/stock/commerce/updated/sender";

import { BOTH, erpFetch, OWN } from "../../lib/per-erp-harness.js";

const IMPORT = "/api/v1/web/demo-erp/admin/import";

let erp;
beforeEach(() => {
  resetErpTokenCache();
  erp = erpFetch();
  vi.stubGlobal("fetch", erp.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetErpsClient();
});

const sent = () => erp.calls.map(({ client, url }) => [client, url]);
const product = (sku) => ({
  origin: { event: "observer.catalog_product_save_commit_after" },
  products: [{ sku }],
});

describe("Given two ERPs", () => {
  beforeEach(() =>
    resetErpsClient({ get: async () => ({ value: JSON.stringify(BOTH) }) }),
  );

  test("Then a product created in Commerce goes to the ERP that owns it, with its own credential", async () => {
    expect(await productCreated(OWN, product("C1"))).toEqual({ success: true });
    expect(sent()).toEqual([["contoso-client", `https://b.example${IMPORT}`]]);
  });

  test("Then a product updated in Commerce goes to the ERP that owns it", async () => {
    await productUpdated(OWN, product("N1"));
    await productUpdated(OWN, product("C1"));
    expect(sent()).toEqual([
      ["integration-client", `https://a.example${IMPORT}`],
      ["contoso-client", `https://b.example${IMPORT}`],
    ]);
  });

  test("Then a stock item saved in Commerce goes to the ERP that owns the product", async () => {
    await stockSaved(OWN, { productId: 7, stock: 3 });
    expect(sent()).toEqual([["contoso-client", `https://b.example${IMPORT}`]]);
    expect(erp.calls[0].body.stock).toEqual([
      { sku: "C7", warehouses: [{ code: "main", quantity: 3 }] },
    ]);
  });

  test("Then a product no ERP owns goes nowhere, and that is a success", async () => {
    const result = await productUpdated(OWN, product("ORPHAN"));
    expect(result).toMatchObject({ skipped: true, success: true });
    expect(erp.calls).toEqual([]);
  });
});

describe("Given one ERP", () => {
  test("Then every product goes to it, as before", async () => {
    await productUpdated(OWN, product("C1"));
    expect(sent()).toEqual([
      ["integration-client", `https://a.example${IMPORT}`],
    ]);
  });
});
