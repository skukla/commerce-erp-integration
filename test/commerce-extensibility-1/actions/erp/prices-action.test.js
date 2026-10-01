/*
 * erp/prices (AB-26z): Demo Builder calls it after a fill, and it can be run again at any
 * time. It reads each ERP's prices in force (GET contracts/in-force, at that ERP's own
 * address) and publishes them into the companies' shared catalogs. A price in force has
 * dates and a Commerce tier price has none, so running it again is what adds a price whose
 * start arrives and removes one whose end has passed.
 */
vi.mock("#lib/erp", () => ({ erp: { inForce: vi.fn() } }));
vi.mock("#lib/erps", async (importOriginal) => ({
  ...(await importOriginal()),
  loadErps: vi.fn(),
}));
vi.mock("#lib/contract-prices", async (importOriginal) => ({
  ...(await importOriginal()),
  publishErpPrices: vi.fn(),
}));

import { publishErpPrices } from "#lib/contract-prices";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { main } from "#src/erp/prices/index";

const ERP = (id, baseUrl) => ({
  adapter: "demo-erp",
  connection: { baseUrl },
  id,
  name: `${id} ERP`,
});
const TWO = [
  ERP("acme", "https://a.example"),
  ERP("globex", "https://g.example"),
];
const ITEMS = {
  "https://a.example": [{ lines: [{ sku: "A1" }], partnerId: "C1" }],
  "https://g.example": [{ lines: [], partnerId: "C2" }],
};
const post = (body = {}) => ({
  __ow_body: JSON.stringify(body),
  __ow_method: "post",
});
const counts = (n) => ({
  failed: [],
  removed: n,
  skipped: [{ erpId: "x", partnerId: "C9", reason: "no catalog" }],
  unchanged: 0,
  written: n,
});

beforeEach(() => {
  loadErps.mockResolvedValue(TWO);
  erp.inForce.mockImplementation(async (params) => ({
    data: { items: ITEMS[params.ERP_BASE_URL] },
    ok: true,
    status: 200,
  }));
  publishErpPrices.mockResolvedValue(counts(1));
});
afterEach(() => vi.clearAllMocks());

describe("Given erp/prices", () => {
  test("Then every ERP's prices in force are read at its own address and published for that ERP, and the counts add up", async () => {
    const res = await main(post());
    expect(res.statusCode).toBe(200);
    expect(erp.inForce.mock.calls.map(([p]) => p.ERP_BASE_URL)).toEqual([
      "https://a.example",
      "https://g.example",
    ]);
    expect(publishErpPrices).toHaveBeenCalledTimes(2);
    const [params, entry, items, deps] = publishErpPrices.mock.calls[0];
    expect(params.__ow_method).toBe("post");
    expect(entry.id).toBe("acme");
    expect(items).toEqual(ITEMS["https://a.example"]);
    expect(Object.keys(deps).sort()).toEqual([
      "commerceCompanyOf",
      "expectSkus",
      "ledger",
      "ownsSku",
      "tierPrices",
      "websiteIdsOf",
    ]);
    expect(res.body).toEqual({
      erps: ["acme", "globex"],
      failed: [],
      removed: 2,
      skipped: [
        { erpId: "x", partnerId: "C9", reason: "no catalog" },
        { erpId: "x", partnerId: "C9", reason: "no catalog" },
      ],
      unchanged: 0,
      written: 2,
    });
  });

  test("Then one ERP can be asked for by id, and an unknown id is refused", async () => {
    const res = await main(post({ erpId: "globex" }));
    expect(res.body.erps).toEqual(["globex"]);
    expect(publishErpPrices.mock.calls[0][1].id).toBe("globex");
    const unknown = await main(post({ erpId: "nope" }));
    expect(unknown.error.statusCode).toBe(400);
  });

  test("Then an ERP that does not answer is reported and nothing of its prices is touched; the others still publish", async () => {
    erp.inForce.mockImplementation(async (params) =>
      params.ERP_BASE_URL === "https://a.example"
        ? { data: {}, ok: false, status: 503 }
        : { data: { items: [] }, ok: true, status: 200 },
    );
    const res = await main(post());
    expect(publishErpPrices).toHaveBeenCalledTimes(1);
    expect(res.body.failed).toEqual([
      { erpId: "acme", error: "the ERP's prices in force answered 503" },
    ]);
  });

  test("Then only POST is answered", async () => {
    const res = await main({ __ow_method: "get" });
    expect(res.error.statusCode).toBe(400);
  });
});
