/*
 * The Commerce readers against what Commerce actually answered (AB-26b, the contract tier).
 * Every body here is a live response from the Bodea sandbox, captured 2026-09-27 into
 * test/fixtures/commerce/ with contact details and hostnames replaced. The readers' other
 * tests hand them rows written for the test; these hand them Commerce's own, so a field the
 * code reads that Commerce does not send fails here, not in a demo.
 */
import { readFileSync } from "node:fs";

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ get: mockGet, post: mockPost })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import {
  customerCompanyId,
  findOrderByIncrementId,
  listSources,
  listWebsites,
  readCompanyRow,
  sourceCodesOf,
  unholdIfHeld,
  warehousesOfSku,
} from "#lib/commerce";

/** A captured body, as Commerce answered it. */
function captured(name) {
  const file = new URL(`../fixtures/commerce/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")).body;
}

/** The empty page a search endpoint answers past its last item. */
const PAST_THE_END = { items: [], total_count: 0 };

/** The client answers each path from its capture; a later page is past the end. */
function commerce(byPath) {
  mockGet.mockImplementation((path, options) => ({
    json: () => {
      const page = options?.searchParams?.["searchCriteria[currentPage]"];
      if (!(path in byPath)) {
        return Promise.reject(
          Object.assign(new Error(`no capture for ${path}`), {
            response: { status: 404 },
          }),
        );
      }
      return Promise.resolve(
        page && page !== "1" ? PAST_THE_END : captured(byPath[path]),
      );
    },
  }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given Commerce's own answers about stock", () => {
  test("Then a SKU's stock is read per source from the source-items search, named", async () => {
    commerce({
      "inventory/source-items": "source-items-accessmesh",
      "inventory/sources": "sources",
    });
    expect(await warehousesOfSku({}, "accessmesh")).toEqual([
      { code: "default", name: "Default Source", quantity: 994 },
    ]);
  });

  test("Then the SKU's sources are the codes the search answers", async () => {
    commerce({ "inventory/source-items": "source-items-accessmesh" });
    expect(await sourceCodesOf({}, "accessmesh")).toEqual(["default"]);
  });

  test("Then the sources are named by code", async () => {
    commerce({ "inventory/sources": "sources" });
    expect(await listSources({})).toEqual(
      new Map([["default", "Default Source"]]),
    );
  });
});

describe("Given Commerce's own answers about companies", () => {
  test("Then a company's row carries its credit, legal identity and its admin's website", async () => {
    commerce({
      "company/21": "company-21",
      "companyCredits/company/21": "company-credit-21",
      "customers/44": "customer-44",
    });
    expect(await readCompanyRow({}, 21)).toEqual({
      blocked: false,
      creditId: 21,
      creditLimit: 120_000,
      customerGroupId: 19,
      email: "company@example.com",
      id: 21,
      legalAddress: {
        city: "Springfield",
        countryId: "US",
        postcode: "12345",
        region: null,
        street: ["1 Demo Way"],
        telephone: "5550100",
      },
      legalName: "Example Studios, LLC",
      name: "Example Studios",
      resellerId: null,
      status: 1,
      vatTaxId: null,
      websiteId: 3,
    });
  });

  test("Then a customer's company is read off its company attributes", async () => {
    commerce({ "customers/44": "customer-44" });
    expect(await customerCompanyId({}, 44)).toBe("21");
  });
});

describe("Given Commerce's own answers about orders", () => {
  test("Then an order found by increment id gives the ids a write needs", async () => {
    commerce({ orders: "orders-by-increment" });
    expect(await findOrderByIncrementId({}, "3000000011")).toEqual({
      entityId: 11,
      extOrderId: "NORT-0000001001",
      storeId: 3,
    });
  });

  test("Then a complete order is not On Hold, so nothing is taken off hold", async () => {
    commerce({ "orders/11": "order-11" });
    expect(await unholdIfHeld({}, 11)).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe("Given Commerce's own answers about the store", () => {
  test("Then the websites leave out Admin", async () => {
    commerce({ "store/websites": "websites" });
    expect(await listWebsites({})).toEqual([
      { code: "base", id: 1, name: "Main Website" },
      { code: "citisignal", id: 2, name: "CitiSignal Website" },
      { code: "bodea", id: 3, name: "Bodea Website" },
      { code: "evo", id: 4, name: "Evo" },
    ]);
  });
});
