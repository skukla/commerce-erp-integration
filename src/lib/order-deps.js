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
} from "#lib/commerce";
import { erp } from "#lib/erp";
import { availabilityOf } from "#lib/erp-availability";
import { loadErps } from "#lib/erps";
import { recordOrderOutcome } from "#lib/history";
import { erpCustomerOf } from "#lib/key-map";
import { settingsFor } from "#lib/settings";
import { ownsSku } from "#lib/structure";
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
    ownsSku: (p, sku, settings) =>
      ownsSku(p, sku, settings, { productAttributes, sourceCodesOf }),
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
    // Read only when a part of a split order is sent (lib/erp-settings.js).
    websiteCodeOf: async (p, storeId) => websiteCodeOfStore(p, storeId),
  };
}
