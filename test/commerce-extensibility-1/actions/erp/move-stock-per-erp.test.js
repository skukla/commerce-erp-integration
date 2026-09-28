/*
 * A stock move from the product grid, with several ERPs (AB-16h): each moved product's stock is
 * told to the ERP that owns the product (router/ownership.js), at its own address and signed with
 * its own credential; one import per ERP. Before, the whole move went to the first ERP.
 */
vi.mock("@adobe/aio-commerce-sdk/auth", async (original) =>
  (await import("../../../lib/per-erp-harness.js")).mintPerClient(original),
);
vi.mock("#lib/commerce", () => ({
  listSources: vi.fn(async () => new Map()),
  productAttributes: vi.fn(async (_params, sku) =>
    sku === "ORPHAN"
      ? {}
      : { erp_owner: sku.startsWith("C") ? "contoso" : "erp" },
  ),
  skusForProductIds: vi.fn(async () => ["C1", "N1", "C2", "ORPHAN"]),
  sourceCodesOf: vi.fn(async () => []),
  transferAllStock: vi.fn(async () => true),
  transferSomeStock: vi.fn(async () => []),
  warehousesOfSku: vi.fn(async () => [{ code: "east", quantity: 5 }]),
}));
vi.mock("#lib/settings", () => ({ settingsFor: vi.fn(async () => ({})) }));

import { resetErpTokenCache } from "#lib/erp";
import { resetErpsClient } from "#lib/erps";
import { main } from "#src/erp/move-stock/index";

import { BOTH, erpFetch, OWN } from "../../../lib/per-erp-harness.js";

const IMPORT = "/api/v1/web/demo-erp/admin/import";
const MOVE = {
  ...OWN,
  __ow_body: JSON.stringify({
    from: "default",
    productIds: [1, 2, 3, 4],
    to: "east",
  }),
  __ow_method: "post",
};

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

const told = () =>
  erp.calls.map(({ body, client, url }) => [
    client,
    url,
    body.stock.map((s) => s.sku),
  ]);

describe("Given two ERPs", () => {
  test("Then each ERP is told the stock of the products it owns, with its own credential", async () => {
    resetErpsClient({ get: async () => ({ value: JSON.stringify(BOTH) }) });
    const res = await main(MOVE);
    expect(res.statusCode).toBe(200);
    expect(told()).toEqual([
      ["contoso-client", `https://b.example${IMPORT}`, ["C1", "C2"]],
      ["integration-client", `https://a.example${IMPORT}`, ["N1"]],
    ]);
  });

  // The page says what the move did: which ERP was told which products, and which product
  // no one ERP owns, so no ERP was told (before, it said the first ERP had them all).
  test("Then the answer says which ERP was told which products, and which went to none", async () => {
    resetErpsClient({ get: async () => ({ value: JSON.stringify(BOTH) }) });
    const res = await main(MOVE);
    expect(res.body).toStrictEqual({
      erp: "updated",
      moved: ["C1", "N1", "C2", "ORPHAN"],
      told: [
        { name: "Contoso ERP", skus: ["C1", "C2"] },
        { name: "Northwind ERP", skus: ["N1"] },
      ],
      untold: ["ORPHAN"],
    });
  });

  test("Then the sources answer names every ERP, for the page to say where a move goes", async () => {
    resetErpsClient({ get: async () => ({ value: JSON.stringify(BOTH) }) });
    const res = await main({ ...OWN, __ow_method: "get" });
    expect(res.body.erpNames).toEqual(["Northwind ERP", "Contoso ERP"]);
  });

  test("Then an ERP that refuses fails the move's answer, naming it", async () => {
    resetErpsClient({ get: async () => ({ value: JSON.stringify(BOTH) }) });
    erp = erpFetch((url) =>
      url.startsWith("https://b.") ? { body: {}, status: 503 } : undefined,
    );
    vi.stubGlobal("fetch", erp.fetch);
    const res = await main(MOVE);
    expect(res.error.statusCode).toBe(500);
    expect(res.error.body.message).toContain("Contoso ERP");
  });
});

describe("Given one ERP", () => {
  test("Then every product's stock goes to it in one import, as before", async () => {
    const res = await main(MOVE);
    expect(res.body).toStrictEqual({
      erp: "updated",
      moved: ["C1", "N1", "C2", "ORPHAN"],
    });
    expect(
      (await main({ ...OWN, __ow_method: "get" })).body.erpNames,
    ).toBeUndefined();
    expect(told()).toEqual([
      [
        "integration-client",
        `https://a.example${IMPORT}`,
        ["C1", "N1", "C2", "ORPHAN"],
      ],
    ]);
  });
});
