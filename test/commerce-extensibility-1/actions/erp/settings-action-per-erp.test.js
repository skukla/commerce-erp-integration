/*
 * The resolved settings for one ERP (Phase B slice B3b): Demo Builder's fill asks
 * `GET erp/settings?websites=...&erp=<id>` and gets the integration's settings with that ERP's
 * own on top, per website. Without `erp` the answer is unchanged (settings-action.test.js).
 */
vi.mock("#lib/settings", async (importOriginal) => ({
  ...(await importOriginal()),
  resolvedSettings: vi.fn(async (codes) => ({
    default: { structure_owns: "all", structure_sales_org: "1000" },
    websites: Object.fromEntries(
      codes.map((code) => [code, { structure_sales_org: "1000" }]),
    ),
  })),
}));
vi.mock("@adobe/aio-commerce-lib-config", () => ({
  byCodeAndLevel: vi.fn(),
  initialize: vi.fn(),
}));

import { resetErpsClient } from "#lib/erps";
import { main } from "#src/erp/settings/index";

const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "brand-a",
    name: "A",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "brand-b",
    name: "B",
    settings: {
      structure_owns: "sources",
      structure_owns_sources: "east",
      websites: { bodea: { structure_sales_org: "2100" } },
    },
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://c.example" },
    id: "brand-c",
    name: "C",
    settings: {
      structure_owns: "websites",
      structure_owns_websites: "bodea, eu",
    },
  },
];

beforeEach(() => {
  const store = new Map([["erp-list", JSON.stringify(ERPS)]]);
  resetErpsClient({
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  });
});

describe("Given the resolved settings asked for one ERP", () => {
  test("Then an ERP owning the products sold on named websites answers that mode and its website codes, so Demo Builder fills it from those websites (AB-64)", async () => {
    const res = await main({
      __ow_method: "get",
      erp: "brand-c",
      websites: "base,bodea",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.default).toMatchObject({
      structure_owns: "websites",
      structure_owns_websites: "bodea, eu",
    });
    expect(res.body.websites.base).toMatchObject({
      structure_owns: "websites",
      structure_owns_websites: "bodea, eu",
    });
  });

  test("Then that ERP's own settings sit on top of the integration's, per website", async () => {
    const res = await main({
      __ow_method: "get",
      erp: "brand-b",
      websites: "base,bodea",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.default).toMatchObject({
      structure_owns: "sources",
      structure_owns_sources: "east",
      structure_sales_org: "1000",
    });
    expect(res.body.websites.bodea.structure_sales_org).toBe("2100");
    expect(res.body.websites.base.structure_sales_org).toBe("1000");
  });

  test("Then an ERP with no ownership of its own owns what routing gives it: the products whose erp_owner holds its id", async () => {
    // The integration's "all" would fill this ERP with every product while routing sends it
    // only its erp_owner products (router/ownership.js). Measured on Bodea 2026-09-28.
    const res = await main({
      __ow_method: "get",
      erp: "brand-a",
      websites: "bodea",
    });
    expect(res.body.default).toMatchObject({
      structure_owns: "attribute",
      structure_owns_attribute: "erp_owner=brand-a",
    });
    expect(res.body.websites.bodea).toMatchObject({
      structure_owns: "attribute",
      structure_owns_attribute: "erp_owner=brand-a",
    });
  });

  test("Then an ERP not in the list is refused", async () => {
    const res = await main({
      __ow_method: "get",
      erp: "nobody",
      websites: "base",
    });
    expect(res.error.statusCode).toBe(400);
  });
});
