/*
 * The Commerce reads the Admin page needs beyond the sync's own, each from Adobe's Commerce as a
 * Cloud Service REST reference (developer.adobe.com/commerce/webapi/reference/rest/saas/):
 *
 * - GET /V1/order-statuses, "Get all configured order statuses with their state assignments":
 *   the statuses a merchant can pick for "Order status when the ERP confirms". A comment sets
 *   only a status of the order's current state, and a confirmed order is still Pending, so the
 *   choices are the Pending state's (`new`) statuses other than its default.
 * - GET /V1/company/ with searchCriteria, "Returns the list of companies": the page's search
 *   finds a company by a part of its name.
 *
 * Neither is yet captured live (docs/commerce-api-inventory.md); the page falls back to a text
 * box when the status read fails.
 */
import { commerceClient } from "#lib/commerce";

/** Commerce's Pending state. */
const PENDING_STATE = "new";
/** How many companies a name search answers. */
const NAME_MATCHES = 10;
/** The search's own wildcards (`like`), taken out of a typed name. */
const WILDCARDS = /[%_]/gu;

/**
 * @returns {Promise<Array<{ value: string, label: string }>>} the Pending state's statuses
 *   that are not its default, by label
 */
export async function pendingOrderStatuses(params) {
  const client = await commerceClient(params);
  const statuses = await client.get("order-statuses").json();
  if (!Array.isArray(statuses)) {
    return [];
  }
  return statuses
    .filter((entry) => entry.state === PENDING_STATE && !entry.default)
    .map((entry) => ({
      label: String(entry.label ?? entry.status),
      value: String(entry.status),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Companies whose name contains the text.
 * @param {object} params action params
 * @param {string} text a part of the name
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export async function findCompaniesByName(params, text) {
  const client = await commerceClient(params);
  const plain = String(text).trim().replace(WILDCARDS, "");
  const page = await client
    .get("company/", {
      searchParams: {
        "searchCriteria[currentPage]": "1",
        "searchCriteria[filter_groups][0][filters][0][condition_type]": "like",
        "searchCriteria[filter_groups][0][filters][0][field]": "company_name",
        "searchCriteria[filter_groups][0][filters][0][value]": `%${plain}%`,
        "searchCriteria[pageSize]": String(NAME_MATCHES),
      },
    })
    .json();
  return (page?.items ?? []).map((company) => ({
    id: String(company.id),
    name: String(company.company_name ?? ""),
  }));
}
