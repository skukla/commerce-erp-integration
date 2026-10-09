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

  test("Then a product updated in Commerce goes to the ERP that owns it, and the other ERP, still holding it, discontinues it (AB-70)", async () => {
    const result = await productUpdated(OWN, product("N1"));
    await productUpdated(OWN, product("C1"));
    // After each send, the OWNER is asked whether it holds the product discontinued (the
    // harness answers every route 200 with {}: it does not, so nothing is restored), then the
    // OTHER ERP is asked whether it holds the product and told it is discontinued
    // (lib/discontinue-elsewhere.js).
    expect(sent()).toEqual([
      ["integration-client", `https://a.example${IMPORT}`],
      [
        "integration-client",
        "https://a.example/api/v1/web/demo-erp/products/N1",
      ],
      ["contoso-client", "https://b.example/api/v1/web/demo-erp/products/N1"],
      ["contoso-client", "https://b.example/api/v1/web/demo-erp/products/N1"],
      ["contoso-client", `https://b.example${IMPORT}`],
      ["contoso-client", "https://b.example/api/v1/web/demo-erp/products/C1"],
      [
        "integration-client",
        "https://a.example/api/v1/web/demo-erp/products/C1",
      ],
      [
        "integration-client",
        "https://a.example/api/v1/web/demo-erp/products/C1",
      ],
    ]);
    expect(erp.calls[3].body).toEqual({ salesStatus: "discontinued" });
    expect(result).toEqual({ discontinuedIn: ["contoso"], success: true });
  });

  test("Then a product back with an ERP that had discontinued it is made sellable there again (AB-70)", async () => {
    // Contoso owns C1 again and still holds it discontinued; Northwind no longer holds it.
    erp = erpFetch((url, init) => {
      if (init.method === "GET" && url.endsWith("/products/C1")) {
        return url.startsWith("https://b.example")
          ? { body: { salesStatus: "discontinued", sku: "C1", type: "simple" } }
          : { body: { error: "not found" }, status: 404 };
      }
    });
    vi.stubGlobal("fetch", erp.fetch);

    const result = await productUpdated(OWN, product("C1"));

    expect(sent()).toEqual([
      ["contoso-client", `https://b.example${IMPORT}`],
      ["contoso-client", "https://b.example/api/v1/web/demo-erp/products/C1"],
      ["contoso-client", "https://b.example/api/v1/web/demo-erp/products/C1"],
      [
        "integration-client",
        "https://a.example/api/v1/web/demo-erp/products/C1",
      ],
    ]);
    expect(erp.calls[2].method).toBe("PATCH");
    expect(erp.calls[2].body).toEqual({ salesStatus: "sellable" });
    expect(result).toEqual({ restoredIn: ["contoso"], success: true });
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

/*
 * Owner, 2026-10-09: an ERP owning `all` is the catch-all. The product's owner is the one
 * ownership rule (router/ownership.js) names, so the sender needs no rule of its own: a
 * tagged product goes to the attribute ERP and the catch-all is told it is discontinued; an
 * untagged product goes to the catch-all alone.
 */
describe("Given a catch-all ERP (all) and an attribute ERP", () => {
  const CATCH_ALL_AND_ATTRIBUTE = [
    { ...BOTH[0], settings: { structure_owns: "all" } },
    {
      ...BOTH[1],
      settings: {
        structure_owns: "attribute",
        structure_owns_attribute: "erp_owner=contoso",
      },
    },
  ];
  beforeEach(() =>
    resetErpsClient({
      get: async () => ({ value: JSON.stringify(CATCH_ALL_AND_ATTRIBUTE) }),
    }),
  );

  test("Then a tagged product goes to the attribute ERP, and the catch-all, still holding it, discontinues it", async () => {
    const result = await productUpdated(OWN, product("C1"));
    expect(sent()).toEqual([
      ["contoso-client", `https://b.example${IMPORT}`],
      ["contoso-client", "https://b.example/api/v1/web/demo-erp/products/C1"],
      [
        "integration-client",
        "https://a.example/api/v1/web/demo-erp/products/C1",
      ],
      [
        "integration-client",
        "https://a.example/api/v1/web/demo-erp/products/C1",
      ],
    ]);
    expect(erp.calls[3].method).toBe("PATCH");
    expect(erp.calls[3].body).toEqual({ salesStatus: "discontinued" });
    expect(result).toEqual({ discontinuedIn: ["erp"], success: true });
  });

  test("Then an untagged product goes to the catch-all alone", async () => {
    // The attribute ERP does not hold it, so there is nothing to discontinue there.
    erp = erpFetch((url, init) =>
      init.method === "GET" && url.startsWith("https://b.example")
        ? { body: { error: "not found" }, status: 404 }
        : undefined,
    );
    vi.stubGlobal("fetch", erp.fetch);

    const result = await productUpdated(OWN, product("ORPHAN"));

    expect(sent()).toEqual([
      ["integration-client", `https://a.example${IMPORT}`],
      [
        "integration-client",
        "https://a.example/api/v1/web/demo-erp/products/ORPHAN",
      ],
      [
        "contoso-client",
        "https://b.example/api/v1/web/demo-erp/products/ORPHAN",
      ],
    ]);
    expect(result).toEqual({ success: true });
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
