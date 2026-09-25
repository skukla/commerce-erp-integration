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
} from "#lib/commerce";
import { erp } from "#lib/erp";
import { settingsFor } from "#lib/settings";
import { ownsSku } from "#lib/structure";

/**
 * @param {object} logger the action's logger
 * @returns {object} `sendOrderToErp`'s and `retryOrderToErp`'s deps
 */
export function orderSyncDeps(logger) {
  return {
    addNote: (p, orderId, comment) => orders.comment(p, orderId, comment),
    companyIdOf: customerCompanyId,
    erp,
    findOrder: findOrderByIncrementId,
    getOrder: getOrderByIncrementId,
    logger,
    ownsSku: (p, sku, settings) =>
      ownsSku(p, sku, settings, { productAttributes, sourceCodesOf }),
    setExtOrderId,
    settingsFor,
  };
}
