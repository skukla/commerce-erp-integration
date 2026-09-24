/*
 * The readers the business structure adds: a company's legal identity and its admin's
 * website, Commerce's websites and store configuration, and a SKU's sources and
 * attributes for the ownership check. The client is a stand-in answering REST paths.
 */
const mockGet = vi.fn();
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ get: mockGet })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import {
  listCompanies,
  listWebsites,
  productAttributes,
  sourceCodesOf,
  storeConfigs,
} from "#lib/commerce";

/** Answer by path: a page for search endpoints, a document otherwise. */
function answers(byPath) {
  mockGet.mockImplementation((path, options) => ({
    json: () => {
      const answer = byPath[path];
      if (answer === undefined) {
        const error = new Error(`no answer for ${path}`);
        error.response = { status: 404 };
        return Promise.reject(error);
      }
      if (Array.isArray(answer) && options?.searchParams) {
        const page = Number(
          options.searchParams["searchCriteria[currentPage]"],
        );
        return Promise.resolve({
          items: page === 1 ? answer : [],
          total_count: answer.length,
        });
      }
      return Promise.resolve(answer);
    },
  }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the companies with their legal identity", () => {
  test("Then each carries its legal fields and its admin's website, and a company with no admin has none", async () => {
    answers({
      company: [
        {
          city: "Austin",
          company_email: "buyer@acme.example",
          company_name: "Acme",
          country_id: "US",
          customer_group_id: 2,
          id: 7,
          legal_name: "Acme Trading LLC",
          postcode: "78701",
          region: "TX",
          reseller_id: "R-77",
          status: 1,
          street: ["1 Main St", ""],
          super_user_id: 13,
          telephone: "512-555-3322",
          vat_tax_id: "US12-3456789",
        },
        { company_name: "Bare", id: 8, status: 1 },
      ],
      "companyCredits/company/7": { credit_limit: 1000, id: 42 },
      "customers/13": { id: 13, website_id: 2 },
    });
    const companies = await listCompanies({});
    expect(companies[0]).toMatchObject({
      legalAddress: {
        city: "Austin",
        countryId: "US",
        postcode: "78701",
        region: "TX",
        street: ["1 Main St"],
        telephone: "512-555-3322",
      },
      legalName: "Acme Trading LLC",
      resellerId: "R-77",
      vatTaxId: "US12-3456789",
      websiteId: 2,
    });
    expect(companies[1]).toMatchObject({
      creditLimit: null,
      legalAddress: null,
      legalName: null,
      websiteId: null,
    });
  });
});

describe("Given the store's structure", () => {
  test("Then websites leave the Admin website out, and the store configuration speaks once per website", async () => {
    answers({
      "store/storeConfigs": [
        { base_currency_code: "USD", id: 1, locale: "en_US", website_id: 1 },
        { base_currency_code: "USD", id: 2, locale: "es_US", website_id: 1 },
        { base_currency_code: "EUR", id: 3, locale: "de_DE", website_id: 2 },
      ],
      "store/websites": [
        { code: "admin", id: 0, name: "Admin" },
        { code: "base", id: 1, name: "Main Website" },
        { code: "eu", id: 2, name: "Europe" },
      ],
    });
    expect(await listWebsites({})).toEqual([
      { code: "base", id: 1, name: "Main Website" },
      { code: "eu", id: 2, name: "Europe" },
    ]);
    const configs = await storeConfigs({});
    expect(configs.get(1)).toEqual({ currency: "USD", locale: "en_US" });
    expect(configs.get(2)).toEqual({ currency: "EUR", locale: "de_DE" });
  });
  test("Then a SKU's sources and attributes are read for the ownership check", async () => {
    answers({
      "inventory/source-items": [
        { quantity: 1, sku: "A1", source_code: "default" },
        { quantity: 2, sku: "A1", source_code: "east" },
      ],
      "products/A1": {
        custom_attributes: [{ attribute_code: "erp_owner", value: "ACME" }],
        sku: "A1",
      },
    });
    expect(await sourceCodesOf({}, "A1")).toEqual(["default", "east"]);
    expect(await productAttributes({}, "A1")).toEqual({ erp_owner: "ACME" });
  });
});
