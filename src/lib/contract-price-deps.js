/*
 * The collaborators applying ERP contract prices is handed (lib/contract-prices.js), wired
 * to the real Commerce calls, key map and ledger, so every caller prices a company the same
 * way.
 */
import { listWebsites } from "#lib/commerce";
import * as tierPrices from "#lib/commerce-tier-prices";
import { ownedByErp } from "#lib/contract-prices";
import { withErpSettings } from "#lib/erp-settings";
import { commerceCompanyOf } from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { ownershipReaders } from "#lib/ownership-readers";
import { websiteSettings } from "#lib/settings";

/**
 * The Commerce website ids a sales organization sells through, for THIS ERP (AB-46): every
 * website whose effective `structure_sales_org` — the ERP's default, or its value for that
 * website (lib/erp-settings.js) — is the code. Read once per deps. A code no website carries
 * maps to none, and the line is left out rather than published everywhere.
 * @param {object} params action params
 * @param {object|undefined} entry the ERP list entry
 * @returns {(salesOrg: string) => Promise<number[]>}
 */
export function websiteIdsResolver(params, entry) {
  let sites = null;
  return async (salesOrg) => {
    if (!sites) {
      const websites = await listWebsites(params);
      sites = await Promise.all(
        websites.map(async (site) => ({
          id: site.id,
          salesOrg: withErpSettings(
            await websiteSettings(site.code),
            entry,
            site.code,
          ).structure_sales_org,
        })),
      );
    }
    return sites.filter((s) => s.salesOrg === salesOrg).map((s) => s.id);
  };
}

/**
 * @param {object} params action params
 * @param {object[]} erps the ERP list
 * @param {string} erpId the ERP whose prices are applied
 * @param {object} [readers] the ownership readers (lib/ownership-readers.js); pass one set to
 *   every ERP of an invocation so a SKU is read from Commerce once
 * @returns {object} `applyCustomerPrices`'s and `publishErpPrices`'s deps
 */
export function contractPriceDeps(
  params,
  erps,
  erpId,
  readers = ownershipReaders(),
) {
  return {
    commerceCompanyOf,
    expectSkus: readers.expect,
    ledger,
    ownsSku: ownedByErp(params, erps, erpId, readers),
    tierPrices,
    websiteIdsOf: websiteIdsResolver(
      params,
      erps.find((entry) => entry.id === erpId),
    ),
  };
}
