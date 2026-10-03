/*
 * The collaborators an order send is handed (lib/order-sync.js), wired to the real
 * Commerce, ERP and settings clients. Shared by the order save event and the Admin
 * screen's Retry, so both send an order the same way.
 */
import {
  customerCompanyId,
  findOrderByIncrementId,
  getOrderByIncrementId,
  orders,
  productAttributes,
  setExtOrderId,
  sourceCodesOf,
  variantsOfProduct,
  websiteCodeOfStore,
  websiteCodesOf,
} from "#lib/commerce";
import { erp } from "#lib/erp";
import { availabilityOf } from "#lib/erp-availability";
import { loadErps } from "#lib/erps";
import { recordOrderOutcome } from "#lib/history";
import { erpCustomerOf } from "#lib/key-map";
import { settingsFor } from "#lib/settings";
import { ownsLine } from "#lib/structure";
import { routeOrder } from "#router/route-order";

/**
 * @param {object} logger the action's logger
 * @returns {object} `sendOrderToErp`'s and `retryOrderToErp`'s deps
 */
export function orderSyncDeps(logger) {
  return {
    addNote: (p, orderId, comment) => orders.comment(p, orderId, comment),
    companyIdOf: customerCompanyId,
    erp,
    erpCustomerOf,
    findOrder: findOrderByIncrementId,
    getOrder: getOrderByIncrementId,
    loadErps,
    logger,
    // The router asks with the order's website (router/ownership.js ownersOfLine, AB-64).
    ownsSku: (p, sku, settings, websiteCode) =>
      ownsLine(p, { sku, websiteCode }, settings, {
        productAttributes,
        sourceCodesOf,
        websiteCodesOf,
      }),
    // Available-to-promise, asked of each ERP just before its part is sent and recorded on
    // the part (router/route-order.js; AB-19). Never a reason to hold: a failed ask leaves
    // no promise and the send goes on.
    promisesFor: (p, erpEntry, lines) => availabilityOf(p, erpEntry, lines),
    recordProgress: (order, step) =>
      recordOrderOutcome(order, step, { logger, progress: true }),
    // The Admin screen's Retry sends through the router, as the order event does.
    send: routeOrder,
    setExtOrderId,
    settingsFor,
    // The router's variant check, with several ERPs only (router/route-order.js). Wrapped,
    // so a path that never checks variants never touches the binding.
    variantsOf: (p, productId) => variantsOfProduct(p, productId),
    // Read when a part of a split order is sent (lib/erp-settings.js) and, when an ERP owns
    // by website, before the split (router/route-order.js).
    websiteCodeOf: async (p, storeId) => websiteCodeOfStore(p, storeId),
  };
}
