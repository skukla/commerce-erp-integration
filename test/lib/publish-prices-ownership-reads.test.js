/*
 * How many times publishing contract prices asks Commerce who owns a product. Measured live
 * on 2026-10-01: two ERPs and 72 price lines read products/{sku} once per SKU per ERP (144
 * GETs), and the blocking publish ran past Runtime's 60 seconds. The owner attributes are now
 * read for many SKUs in one products search, and each SKU only once per publish. The client is
 * a stand-in Commerce answering REST paths; everything past it is the real ownership code.
 */
const mockGet = vi.fn();
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ get: mockGet })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

const ERPS = [{ id: "acme" }, { id: "globex" }];
const inForce = new Map();
vi.mock("#lib/erps", () => ({
  erpById: (erps, id) => erps.find((e) => e.id === id),
  loadErps: async () => ERPS,
}));
vi.mock("#adapters/contract", () => ({
  paramsForErp: (params, entry) => ({ ...params, erpId: entry.id }),
}));
vi.mock("#lib/erp", () => ({
  erp: {
    inForce: async (params) => ({
      data: { items: inForce.get(params.erpId) ?? [] },
      ok: true,
    }),
  },
}));
vi.mock("#lib/ledger", () => ({
  forgetTierPrice: vi.fn(async () => undefined),
  recordTierPriceWrite: vi.fn(async () => undefined),
  tierPriceEntries: vi.fn(async () => []),
}));
vi.mock("#lib/key-map", () => ({ commerceCompanyOf: async () => "7" }));
vi.mock("#lib/settings", () => ({ websiteSettings: async () => ({}) }));
vi.mock("#lib/commerce-tier-prices", () => ({
  ALL_WEBSITES: 0,
  revertTierPrice: vi.fn(async () => undefined),
  sharedCatalogGroupOf: async () => ({ customerGroup: 5 }),
  tierPricesOf: async () => [],
  writeTierPrices: vi.fn(async () => undefined),
}));

import * as tierPrices from "#lib/commerce-tier-prices";
import { contractPriceDeps } from "#lib/contract-price-deps";
import { applyCustomerPrices } from "#lib/contract-prices";
import { publishPrices } from "#lib/publish-prices";

const SKU_FILTER = "searchCriteria[filter_groups][0][filters][0][value]";
const PRODUCT_PATH = /^products\//u;

/** Commerce holding these products, answering a product read and a products search. */
function commerceHolding(products) {
  const product = (sku) => ({
    custom_attributes: [{ attribute_code: "erp_owner", value: products[sku] }],
    sku,
  });
  mockGet.mockImplementation((path, options) => ({
    json: () => {
      if (path === "products") {
        const params = options.searchParams;
        const asked = String(params[SKU_FILTER]).split(",");
        const found = asked.filter((s) => s in products).map(product);
        const size = Number(params["searchCriteria[pageSize]"]);
        const page = Number(params["searchCriteria[currentPage]"]);
        return Promise.resolve({
          items: found.slice((page - 1) * size, page * size),
          total_count: found.length,
        });
      }
      const sku = decodeURIComponent(path.replace(PRODUCT_PATH, ""));
      if (!(sku in products)) {
        const error = new Error(`no product ${sku}`);
        error.response = { status: 404 };
        return Promise.reject(error);
      }
      return Promise.resolve(product(sku));
    },
  }));
}

const productReads = () =>
  mockGet.mock.calls.filter(([path]) => path.startsWith("products"));
const skus = (prefix, n) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const linesFor = (list) =>
  list.map((sku) => ({ kind: "price", price: 9, sku }));
const ownedBy = (list, erpId) =>
  Object.fromEntries(list.map((sku) => [sku, erpId]));
const writtenSkus = () =>
  tierPrices.writeTierPrices.mock.calls.flatMap(([, rows]) =>
    rows.map((r) => r.sku),
  );

beforeEach(() => {
  mockGet.mockReset();
  inForce.clear();
  tierPrices.writeTierPrices.mockClear();
});

describe("Given two ERPs publishing 72 price lines between them", () => {
  const acme = skus("A", 36);
  const globex = skus("G", 36);

  test("Then Commerce is asked for the owners in a bounded number of reads, not once per SKU per ERP", async () => {
    commerceHolding({ ...ownedBy(acme, "acme"), ...ownedBy(globex, "globex") });
    inForce.set("acme", [{ lines: linesFor(acme), partnerId: "P1" }]);
    inForce.set("globex", [{ lines: linesFor(globex), partnerId: "P2" }]);

    const total = await publishPrices({});

    // Before: 144 reads (72 SKUs x 2 ERPs, products/{sku} each). After: one search per ERP.
    expect(productReads()).toHaveLength(2);
    expect(total.written).toBe(72);
    expect(total.failed).toEqual([]);
  });

  test("Then each ERP still prices only the SKUs it alone owns", async () => {
    commerceHolding({ ...ownedBy(acme, "acme"), ...ownedBy(globex, "globex") });
    // Each ERP also sends a line for a product the other one owns.
    inForce.set("acme", [
      { lines: linesFor([...acme, "G1"]), partnerId: "P1" },
    ]);
    inForce.set("globex", [
      { lines: linesFor([...globex, "A1"]), partnerId: "P2" },
    ]);

    const total = await publishPrices({});

    expect(total.written).toBe(72);
    expect(writtenSkus().sort()).toEqual([...acme, ...globex].sort());
    // The SKUs acme's publish already read are not read again for globex.
    expect(productReads()).toHaveLength(2);
  });
});

describe("Given a publish naming more SKUs than one search page holds", () => {
  test("Then the owners are read in pages of at most 100 SKUs", async () => {
    const many = skus("A", 250);
    commerceHolding(ownedBy(many, "acme"));
    inForce.set("acme", [{ lines: linesFor(many), partnerId: "P1" }]);

    const total = await publishPrices({}, "acme");

    expect(total.written).toBe(250);
    const asked = productReads().map(
      ([, options]) =>
        String(options.searchParams[SKU_FILTER]).split(",").length,
    );
    expect(asked).toEqual([100, 100, 50]);
  });
});

describe("Given a line for a product Commerce does not have", () => {
  test("Then that customer fails as it did when each SKU was read on its own, and the others publish", async () => {
    commerceHolding(ownedBy(["A1", "A2"], "acme"));
    inForce.set("acme", [
      { lines: linesFor(["A1", "GONE"]), partnerId: "P1" },
      { lines: linesFor(["A2"]), partnerId: "P2" },
    ]);

    const total = await publishPrices({}, "acme");

    expect(total.failed).toEqual([
      { erpId: "acme", error: "no product GONE", partnerId: "P1" },
    ]);
    expect(total.written).toBe(1);
  });
});

describe("Given one customer's contract event with two ERPs configured", () => {
  test("Then its lines' owners are read in one search", async () => {
    const acme = skus("A", 30);
    commerceHolding(ownedBy(acme, "acme"));

    const result = await applyCustomerPrices(
      {},
      { erpId: "acme", lines: linesFor(acme), partnerId: "P1" },
      contractPriceDeps({}, ERPS, "acme"),
    );

    expect(result.written).toBe(30);
    expect(productReads()).toHaveLength(1);
  });
});
