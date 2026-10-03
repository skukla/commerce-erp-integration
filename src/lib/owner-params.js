/*
 * The ERP a change made in Commerce to a product goes to, wired to the real Commerce readers,
 * settings and ERP list (router/erp-params.js ownerParamsOf). Shared by the product created,
 * product updated and stock item senders.
 */
import {
  productAttributes,
  sourceCodesOf,
  websiteCodesOf,
} from "#lib/commerce";
import { loadErps } from "#lib/erps";
import { settingsFor } from "#lib/settings";
import { ownsSku } from "#lib/structure";
import { ownerParamsOf } from "#router/erp-params";

/**
 * @param {object} params action params
 * @param {string} sku the product
 * @returns {Promise<{ params: object } | { skip: string }>}
 */
export async function ownerParams(params, sku) {
  return ownerParamsOf(params, sku, {
    erps: await loadErps(params),
    ownsSku: (p, s, settings) =>
      ownsSku(p, s, settings, {
        productAttributes,
        sourceCodesOf,
        websiteCodesOf,
      }),
    settingsFor,
  });
}
