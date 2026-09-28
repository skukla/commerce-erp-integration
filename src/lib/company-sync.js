/*
 * A company created or changed in Commerce reaches the ERP by its own event
 * (observer.company_save_commit_after), where the integration used to refresh every
 * partner every minute (owner, 2026-09-27: events for every change). The event carries
 * the id; the company is read back by id and becomes the business partner Demo Builder's
 * fill also makes (its erpFillRows.ts carries the same rules), so a company is one record
 * whether an event or a fill brought it. Pure over the readers it is handed.
 */
import { salesOrgOf } from "#lib/structure";

/**
 * ERP business-partner rows; ids are `C<companyId>`. With the websites and each website's
 * sales organization (business structure), a company's admin website names the sales
 * organization it buys through; a company with no admin website belongs to none yet.
 * @param {Array<{id:number, code:string}>} [websites]
 * @param {Map<number, string>} [salesOrgByWebsite] website id → sales organization code
 * @returns {object[]}
 */
export function partnersFrom(
  companies,
  websites = [],
  salesOrgByWebsite = new Map(),
) {
  const siteById = new Map(websites.map((site) => [site.id, site]));
  return companies.map((c) => {
    const site =
      c.websiteId === undefined || c.websiteId === null
        ? null
        : siteById.get(Number(c.websiteId));
    return {
      creditLimit: c.creditLimit ?? undefined,
      id: `C${c.id}`,
      legalAddress: c.legalAddress ?? null,
      legalName: c.legalName ?? null,
      name: c.name,
      resellerId: c.resellerId ?? null,
      salesOrgs: site ? [salesOrgByWebsite.get(site.id) ?? "1000"] : [],
      vatTaxId: c.vatTaxId ?? null,
      // Commerce's company Active/Blocked switch, as the ERP's read-only website account
      // (contract version 5). It never sets the ERP's own credit block.
      websiteAccountClosed: Boolean(c.blocked),
    };
  });
}

/**
 * The customer is the one the key map pairs with the company, else a new `C<id>`, paired
 * once the ERP has taken it.
 * @param {object} deps `{ readCompanyRow, listWebsites, websiteSettings, importRecords, erpCustomerOf, pairCustomer }`
 * @returns {Promise<object>} the business partner sent
 */
export async function companyToErp(params, companyId, origin, deps) {
  const [row, websites, paired] = await Promise.all([
    deps.readCompanyRow(params, companyId),
    deps.listWebsites(params),
    deps.erpCustomerOf(companyId),
  ]);
  const site = websites.find((website) => website.id === row.websiteId);
  const salesOrgByWebsite = new Map();
  if (site) {
    const settings = await deps.websiteSettings(site.code);
    salesOrgByWebsite.set(site.id, salesOrgOf(settings).salesOrg);
  }
  const [made] = partnersFrom([row], websites, salesOrgByWebsite);
  const partner = paired ? { ...made, id: paired } : made;
  const answer = await deps.importRecords(params, {
    origin,
    partners: [partner],
  });
  if (!answer.ok) {
    throw new Error(
      `ERP import answered ${answer.status}: ${answer.data?.errorMessage || "no reason given"}`,
    );
  }
  await deps.pairCustomer(String(row.id ?? companyId), partner.id);
  return partner;
}
