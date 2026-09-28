/*
 * The collaborators applying ERP contract prices is handed (lib/contract-prices.js), wired
 * to the real Commerce calls, key map and ledger, so every caller prices a company the same
 * way.
 */
import { productAttributes, sourceCodesOf } from "#lib/commerce";
import * as tierPrices from "#lib/commerce-tier-prices";
import { ownedByErp } from "#lib/contract-prices";
import { commerceCompanyOf } from "#lib/key-map";
import * as ledger from "#lib/ledger";

/**
 * @param {object} params action params
 * @param {object[]} erps the ERP list
 * @param {string} erpId the ERP whose prices are applied
 * @returns {object} `applyCustomerPrices`'s and `publishErpPrices`'s deps
 */
export function contractPriceDeps(params, erps, erpId) {
  return {
    commerceCompanyOf,
    ledger,
    ownsSku: ownedByErp(params, erps, erpId, {
      productAttributes,
      sourceCodesOf,
    }),
    tierPrices,
  };
}
