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
];

beforeEach(() => {
  const store = new Map([["erp-list", JSON.stringify(ERPS)]]);
  resetErpsClient({
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  });
});

describe("Given the resolved settings asked for one ERP", () => {
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

  test("Then an ERP not in the list is refused", async () => {
    const res = await main({
      __ow_method: "get",
      erp: "nobody",
      websites: "base",
    });
    expect(res.error.statusCode).toBe(400);
  });
});
