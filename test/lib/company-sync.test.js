/*
 * A company saved in Commerce reaches the ERP by its own event (lib/company-sync.js), as the
 * same business partner the mirror makes. The company row is the mirror's shape (companyRow in
 * lib/commerce.js, read from Bodea's company 21, test/fixtures/commerce).
 */
import { companyToErp } from "#lib/company-sync";

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
    importRecords: vi.fn(async () => ({ data: {}, ok: true, status: 200 })),
    listWebsites: vi.fn(async () => WEBSITES),
    readCompanyRow: vi.fn(async () => ROW),
    websiteSettings: vi.fn(async () => ({ structure_sales_org: "US01" })),
  };
}

describe("Given a company saved in Commerce", () => {
  test("Then it is read by id and sent as the business partner the mirror would make", async () => {
    const d = deps();
    const partner = await companyToErp({}, 21, ORIGIN, d);

    expect(d.readCompanyRow).toHaveBeenCalledWith({}, 21);
    expect(d.websiteSettings).toHaveBeenCalledWith("bodea");
    expect(d.importRecords).toHaveBeenCalledWith(
      {},
      { origin: ORIGIN, partners: [partner] },
    );
    expect(partner).toMatchObject({
      commerceCompanyId: "21",
      creditLimit: 120_000,
      customerGroupId: "19",
      id: "C21",
      salesOrgs: ["US01"],
      website: { code: "bodea", id: 3 },
    });
  });

  test("Then a company with no admin website belongs to no sales organisation, and no website is read", async () => {
    const d = deps();
    d.readCompanyRow.mockResolvedValue({ ...ROW, websiteId: null });
    const partner = await companyToErp({}, 21, ORIGIN, d);

    expect(d.websiteSettings).not.toHaveBeenCalled();
    expect(partner).toMatchObject({ salesOrgs: [], website: null });
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
