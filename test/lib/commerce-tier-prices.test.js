/*
 * The Commerce calls behind ERP contract prices (AB-26z): which customer group a company's
 * shared catalog prices for, and the tier-price reads and writes. A shared catalog's custom
 * price IS a quantity-1 tier price for the catalog's customer group, keyed by the group's
 * CODE (measured on Bodea 2026-09-26). The company, group and catalog bodies are live
 * captures (test/fixtures/commerce/); the tier-price bodies follow Adobe's "Manage prices
 * for multiple products" page (developer.adobe.com/commerce/webapi/rest/modules/catalog/
 * catalog-pricing), read 2026-09-28.
 */
import { readFileSync } from "node:fs";

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}));
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ get: mockGet, post: mockPost })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import {
  deleteTierPrices,
  revertTierPrice,
  sharedCatalogGroupOf,
  tierPricesOf,
  writeTierPrices,
} from "#lib/commerce-tier-prices";

function captured(name) {
  const file = new URL(`../fixtures/commerce/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")).body;
}
const answer = (body) => ({ json: () => Promise.resolve(body) });

/** GET answers by path prefix: company, customer group, the catalog search. */
function commerce({ company, group, catalogs }) {
  mockGet.mockImplementation((path) => {
    if (path.startsWith("company/")) {
      return answer(company);
    }
    if (path.startsWith("customerGroups/")) {
      return answer(group);
    }
    if (path === "sharedCatalog") {
      return answer(catalogs);
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

const ROW = {
  customer_group: "Example Studios",
  price: 40,
  price_type: "fixed",
  quantity: 1,
  sku: "accessmesh",
  website_id: 0,
};

describe("Given a company to price for", () => {
  test("Then its shared catalog's customer group is found by the company's group, and named by the group's code", async () => {
    commerce({
      catalogs: captured("shared-catalogs-group-19"),
      company: captured("company-21"),
      group: captured("customer-group-19"),
    });
    const target = await sharedCatalogGroupOf({}, "21");
    expect(target).toEqual({
      customerGroup: "Example Studios",
      customerGroupId: 19,
      sharedCatalogId: 14,
    });
    expect(mockGet).toHaveBeenCalledWith("company/21");
    expect(mockGet).toHaveBeenCalledWith("customerGroups/19");
    expect(mockGet).toHaveBeenCalledWith("sharedCatalog", {
      searchParams: {
        "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
        "searchCriteria[filter_groups][0][filters][0][field]":
          "customer_group_id",
        "searchCriteria[filter_groups][0][filters][0][value]": "19",
      },
    });
  });

  // A company on the public catalog's group (General) must never be priced: a tier price
  // there would reach every logged-in buyer who is not in a company catalog.
  test("Then a company on the public catalog, or on a group no catalog uses, is a skip with the reason", async () => {
    commerce({
      catalogs: {
        items: [{ customer_group_id: 1, id: 1, type: 1 }],
        total_count: 1,
      },
      company: { customer_group_id: 1, id: 18 },
      group: { code: "General", id: 1 },
    });
    expect(await sharedCatalogGroupOf({}, "18")).toEqual({
      skip: "company 18 has no custom shared catalog (its customer group 1 is the public catalog's)",
    });
    commerce({
      catalogs: { items: [], total_count: 0 },
      company: { customer_group_id: 5, id: 20 },
      group: { code: "Wholesale", id: 5 },
    });
    expect(await sharedCatalogGroupOf({}, "20")).toEqual({
      skip: "company 20 has no custom shared catalog (no shared catalog uses its customer group 5)",
    });
  });
});

describe("Given tier prices to read and write", () => {
  test("Then reading asks tier-prices-information for the SKUs", async () => {
    mockPost.mockReturnValue(answer([ROW]));
    expect(await tierPricesOf({}, ["accessmesh"])).toEqual([ROW]);
    expect(mockPost).toHaveBeenCalledWith("products/tier-prices-information", {
      json: { skus: ["accessmesh"] },
    });
    mockPost.mockClear();
    expect(await tierPricesOf({}, [])).toEqual([]);
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("Then a write posts the rows to tier-prices and a delete to tier-prices-delete", async () => {
    mockPost.mockReturnValue(answer([]));
    await writeTierPrices({}, [ROW]);
    expect(mockPost).toHaveBeenCalledWith("products/tier-prices", {
      json: { prices: [ROW] },
    });
    await deleteTierPrices({}, [ROW]);
    expect(mockPost).toHaveBeenCalledWith("products/tier-prices-delete", {
      json: { prices: [ROW] },
    });
    mockPost.mockClear();
    await writeTierPrices({}, []);
    expect(mockPost).not.toHaveBeenCalled();
  });

  // The storage interface answers the rows it could not save, not an HTTP error; a write
  // that quietly failed would be ledgered as done and never undone.
  test("Then rows Commerce answers as failed are an error naming them", async () => {
    mockPost.mockReturnValue(
      answer([
        {
          message: "Invalid attribute %fieldName = %fieldValue.",
          parameters: ["customer_group", "Nobody"],
        },
      ]),
    );
    await expect(writeTierPrices({}, [ROW])).rejects.toThrow(
      "Commerce refused 1 tier price(s): Invalid attribute customer_group = Nobody.",
    );
  });
});

describe("Given a ledgered tier price to take back", () => {
  const entry = {
    after: { price: 40, priceType: "fixed" },
    before: null,
    customerGroup: "Example Studios",
    id: "accessmesh",
    kind: "tierPrice",
    quantity: 1,
    websiteId: 0,
  };

  test("Then a row that did not exist before is deleted, as it was written", async () => {
    mockPost.mockReturnValue(answer([]));
    await revertTierPrice({}, entry);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("products/tier-prices-delete", {
      json: { prices: [ROW] },
    });
  });

  test("Then a row that held a price before gets that price back", async () => {
    mockPost.mockReturnValue(answer([]));
    await revertTierPrice(
      {},
      { ...entry, before: { price: 7, priceType: "discount" } },
    );
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("products/tier-prices", {
      json: { prices: [{ ...ROW, price: 7, price_type: "discount" }] },
    });
  });
});
