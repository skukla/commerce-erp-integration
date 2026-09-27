/*
 * A company created or changed in Commerce reaches the ERP by its own event
 * (observer.company_save_commit_after), where the integration used to refresh every
 * partner every minute (owner, 2026-09-27: events for every change). The event carries
 * the id; the company is read back the way the mirror reads it, and becomes the same
 * business partner the mirror would make (lib/mirror.js partnersFrom), so a company is
 * one record whether an event or a fill brought it. Pure over the readers it is handed.
 */
import { partnersFrom } from "#lib/mirror";
import { salesOrgOf } from "#lib/structure";

/**
 * @param {object} deps `{ readCompanyRow, listWebsites, websiteSettings, importRecords }`
 * @returns {Promise<object>} the business partner sent
 */
export async function companyToErp(params, companyId, origin, deps) {
  const [row, websites] = await Promise.all([
    deps.readCompanyRow(params, companyId),
    deps.listWebsites(params),
  ]);
  const site = websites.find((website) => website.id === row.websiteId);
  const salesOrgByWebsite = new Map();
  if (site) {
    const settings = await deps.websiteSettings(site.code);
    salesOrgByWebsite.set(site.id, salesOrgOf(settings).salesOrg);
  }
  const [partner] = partnersFrom([row], websites, salesOrgByWebsite);
  const answer = await deps.importRecords(params, {
    origin,
    partners: [partner],
  });
  if (!answer.ok) {
    throw new Error(
      `ERP import answered ${answer.status}: ${answer.data?.errorMessage || "no reason given"}`,
    );
  }
  return partner;
}
