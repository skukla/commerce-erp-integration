/*
 * The Commerce side of ERP contract prices (AB-26z): which customer group a company's shared
 * catalog prices for, and the tier prices written there.
 *
 * A shared catalog's custom price IS a tier price for the catalog's customer group: on the
 * Bodea sandbox (2026-09-26) ServerSavvy Solutions' catalog price for accessmesh read back
 * from `products/tier-prices-information` as `fixed 49` at quantity 1 for
 * `customer_group: "ServerSavvy Solutions"`, the group's CODE. Commerce stored that row, and
 * Kukla Studios' one, on website 0 although both catalogs belong to Bodea Store (website 3):
 * `GET products/accessmesh` 2026-09-28 (`tier_prices[].extension_attributes.website_id`). So rows are
 * written on website 0, as Commerce's own catalog pricing screen writes them.
 *
 * Endpoints (Adobe, "Manage prices for multiple products", read 2026-09-28):
 * `POST V1/products/tier-prices` adds or updates, `POST V1/products/tier-prices-delete`
 * deletes, `POST V1/products/tier-prices-information` reads; each row is
 * `{ sku, customer_group, website_id, quantity, price, price_type: fixed | discount }`.
 * Shared catalogs: "Manage shared catalogs" (b2b/shared-cat-manage), `GET V1/sharedCatalog`
 * with search criteria; `type` 0 is a custom catalog, 1 the public one.
 */
import { commerceClient } from "#lib/commerce";

/** Where a shared catalog's prices live: every website (see above). */
export const ALL_WEBSITES = 0;
const CUSTOM_CATALOG = 0;

const byGroup = (groupId) => ({
  searchParams: {
    "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
    "searchCriteria[filter_groups][0][filters][0][field]": "customer_group_id",
    "searchCriteria[filter_groups][0][filters][0][value]": String(groupId),
  },
});

/**
 * The customer group a company's custom shared catalog prices for. A company whose group is
 * the public catalog's (General), or a group no catalog uses, gets no prices: a tier price
 * there would reach buyers outside the company (the setup step asks the SC for one catalog
 * per company).
 * @param {object} params action params
 * @param {string|number} companyId the Commerce company
 * @returns {Promise<{ customerGroup: string, customerGroupId: number, sharedCatalogId: number }
 *   | { skip: string }>}
 */
export async function sharedCatalogGroupOf(params, companyId) {
  const client = await commerceClient(params);
  const company = await client.get(`company/${companyId}`).json();
  const groupId = Number(company.customer_group_id);
  const catalogs =
    (await client.get("sharedCatalog", byGroup(groupId)).json()).items ?? [];
  const custom = catalogs.find(
    (c) =>
      Number(c.type) === CUSTOM_CATALOG &&
      Number(c.customer_group_id) === groupId,
  );
  if (!custom) {
    const why =
      catalogs.length > 0
        ? `its customer group ${groupId} is the public catalog's`
        : `no shared catalog uses its customer group ${groupId}`;
    return {
      skip: `company ${companyId} has no custom shared catalog (${why})`,
    };
  }
  const group = await client.get(`customerGroups/${groupId}`).json();
  return {
    customerGroup: group.code,
    customerGroupId: groupId,
    sharedCatalogId: custom.id,
  };
}

/** Commerce's words for a row it refused, with its placeholders filled in. */
function refusal(result) {
  const values = Object.values(result.parameters ?? {});
  let next = 0;
  return String(result.message ?? "refused").replace(/%\w+/gu, (name) => {
    const value = next < values.length ? String(values[next]) : name;
    next += 1;
    return value;
  });
}

/** The storage calls answer the rows they could not save; any is an error. */
function throwOnRefusals(results) {
  const refused = Array.isArray(results) ? results : [];
  if (refused.length > 0) {
    throw new Error(
      `Commerce refused ${refused.length} tier price(s): ${refused.map(refusal).join("; ")}`,
    );
  }
}

/** @returns {Promise<object[]>} every tier price Commerce holds for these SKUs */
export async function tierPricesOf(params, skus) {
  if (skus.length === 0) {
    return [];
  }
  const client = await commerceClient(params);
  return client
    .post("products/tier-prices-information", { json: { skus } })
    .json();
}

/** Add or update tier prices. */
export async function writeTierPrices(params, prices) {
  if (prices.length === 0) {
    return;
  }
  const client = await commerceClient(params);
  throwOnRefusals(
    await client.post("products/tier-prices", { json: { prices } }).json(),
  );
}

/** Delete exactly these tier prices. */
export async function deleteTierPrices(params, prices) {
  if (prices.length === 0) {
    return;
  }
  const client = await commerceClient(params);
  throwOnRefusals(
    await client
      .post("products/tier-prices-delete", { json: { prices } })
      .json(),
  );
}

/**
 * Take back one ledgered tier price (lib/ledger.js, kind `tierPrice`): a row that did not
 * exist before the ERP wrote it is deleted; a row that held a price gets it back.
 * @param {object} params action params
 * @param {object} entry the ledger entry
 */
export function revertTierPrice(params, entry) {
  const row = (value) => ({
    customer_group: entry.customerGroup,
    price: value.price,
    price_type: value.priceType ?? "fixed",
    quantity: Number(entry.quantity),
    sku: entry.id,
    website_id: Number(entry.websiteId),
  });
  return entry.before
    ? writeTierPrices(params, [row(entry.before)])
    : deleteTierPrices(params, [row(entry.after)]);
}
