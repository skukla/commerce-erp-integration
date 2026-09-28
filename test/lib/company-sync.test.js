/*
 * A company saved in Commerce reaches the ERP by its own event (lib/company-sync.js), as the
 * same business partner Demo Builder's fill makes. The company row is companyRow's shape (in
 * lib/commerce.js, read from Bodea's company 21, test/fixtures/commerce).
 */
import { companyToErp, partnersFrom } from "#lib/company-sync";

const COMMERCE_IDS = [
  "commerceCompanyId",
  "customerGroupId",
  "emailDomain",
  "website",
];

const ROW = {
  blocked: false,
  creditId: 21,
  creditLimit: 120_000,
  customerGroupId: 19,
  email: "company@example.com",
  id: 21,
  legalAddress: null,
  legalName: "Example Studios, LLC",
  name: "Example Studios",
  resellerId: null,
  status: 1,
  vatTaxId: null,
  websiteId: 3,
};
const WEBSITES = [
  { code: "base", id: 1, name: "Main Website" },
  { code: "bodea", id: 3, name: "Bodea Website" },
];
const ORIGIN = { event: "observer.company_save_commit_after" };

function deps() {
  return {
    erpCustomerOf: vi.fn(async () => null),
    importRecords: vi.fn(async () => ({ data: {}, ok: true, status: 200 })),
    listWebsites: vi.fn(async () => WEBSITES),
    pairCustomer: vi.fn(async () => undefined),
    readCompanyRow: vi.fn(async () => ROW),
    websiteSettings: vi.fn(async () => ({ structure_sales_org: "US01" })),
  };
}

describe("Given a company saved in Commerce", () => {
  test("Then it is read by id and sent as the business partner the fill would make", async () => {
    const d = deps();
    const partner = await companyToErp({}, 21, ORIGIN, d);

    expect(d.readCompanyRow).toHaveBeenCalledWith({}, 21);
    expect(d.websiteSettings).toHaveBeenCalledWith("bodea");
    expect(d.importRecords).toHaveBeenCalledWith(
      {},
      { origin: ORIGIN, partners: [partner] },
    );
    expect(partner).toMatchObject({
      creditLimit: 120_000,
      id: "C21",
      salesOrgs: ["US01"],
    });
    // The ERP holds no Commerce id (contract version 3): the key map pairs them.
    for (const key of COMMERCE_IDS) {
      expect(partner).not.toHaveProperty(key);
    }
  });

  test("Then a new company is paired in the key map with the customer made for it", async () => {
    const d = deps();
    const partner = await companyToErp({}, 21, ORIGIN, d);
    expect(partner.id).toBe("C21");
    expect(d.pairCustomer).toHaveBeenCalledWith("21", "C21");
    expect(d.pairCustomer.mock.invocationCallOrder[0]).toBeGreaterThan(
      d.importRecords.mock.invocationCallOrder[0],
    );
  });

  test("Then a company the key map already pairs updates that ERP customer, not a new one", async () => {
    const d = deps();
    d.erpCustomerOf.mockResolvedValue("C000103");
    const partner = await companyToErp({}, 21, ORIGIN, d);
    expect(d.erpCustomerOf).toHaveBeenCalledWith(21);
    expect(partner.id).toBe("C000103");
    expect(d.importRecords.mock.calls[0][1].partners[0].id).toBe("C000103");
  });

  test("Then an ERP that refuses leaves the key map alone", async () => {
    const d = deps();
    d.importRecords.mockResolvedValue({ data: {}, ok: false, status: 503 });
    await expect(companyToErp({}, 21, ORIGIN, d)).rejects.toThrow();
    expect(d.pairCustomer).not.toHaveBeenCalled();
  });

  test("Then a company with no admin website belongs to no sales organization, and no website is read", async () => {
    const d = deps();
    d.readCompanyRow.mockResolvedValue({ ...ROW, websiteId: null });
    const partner = await companyToErp({}, 21, ORIGIN, d);

    expect(d.websiteSettings).not.toHaveBeenCalled();
    expect(partner).toMatchObject({ salesOrgs: [] });
  });

  test("Then an ERP that refuses is an error, so the event is delivered again", async () => {
    const d = deps();
    d.importRecords.mockResolvedValue({
      data: { errorMessage: "offline" },
      ok: false,
      status: 503,
    });
    await expect(companyToErp({}, 21, ORIGIN, d)).rejects.toThrow(
      "ERP import answered 503: offline",
    );
  });
});

describe("Given companies turned into business partners", () => {
  test("Then companies become partners keyed C<id> with their credit, and no Commerce group or email domain", () => {
    const rows = partnersFrom([
      {
        creditLimit: 500,
        customerGroupId: 4,
        email: "buyer@acme.example",
        id: 7,
        name: "Acme",
      },
    ]);
    expect(rows).toEqual([
      {
        creditLimit: 500,
        id: "C7",
        legalAddress: null,
        legalName: null,
        name: "Acme",
        resellerId: null,
        salesOrgs: [],
        vatTaxId: null,
        websiteAccountClosed: false,
      },
    ]);
  });
  // Business structure: the company admin's website names the sales organization the
  // company buys through; the legal identity rides along for the customer document.
  test("Then a company's admin website gives its sales organization, and its legal identity comes with it", () => {
    const rows = partnersFrom(
      [
        {
          id: 7,
          legalAddress: {
            city: "Austin",
            countryId: "US",
            postcode: "78701",
            region: "TX",
            street: ["1 Main St"],
            telephone: null,
          },
          legalName: "Acme Trading LLC",
          name: "Acme",
          resellerId: "R-77",
          vatTaxId: "US12-3456789",
          websiteId: 2,
        },
        { id: 8, name: "Nowhere Ltd", websiteId: 9 },
      ],
      [
        { code: "base", id: 1 },
        { code: "eu", id: 2 },
      ],
      new Map([[2, "2000"]]),
    );
    expect(rows[0]).toMatchObject({
      legalAddress: {
        city: "Austin",
        countryId: "US",
        postcode: "78701",
        region: "TX",
        street: ["1 Main St"],
        telephone: null,
      },
      legalName: "Acme Trading LLC",
      resellerId: "R-77",
      salesOrgs: ["2000"],
      vatTaxId: "US12-3456789",
    });
    // A website the read did not list: the company belongs to no sales organization yet.
    expect(rows[1]).toMatchObject({ salesOrgs: [] });
  });
});
