/*
 * The collaborators an order send is handed (lib/order-sync.js), wired to the real
 * Commerce, ERP and settings clients. Shared by the order save event and the Admin
 * screen's Retry, so both send an order the same way.
 */
import {
  findOrderByIncrementId,
  getOrderByIncrementId,
  orders,
  setExtOrderId,
} from "#lib/commerce";
import { erp } from "#lib/erp";
import { settingsFor } from "#lib/settings";

/**
 * @param {object} logger the action's logger
 * @returns {object} `sendOrderToErp`'s and `retryOrderToErp`'s deps
 */
export function orderSyncDeps(logger) {
  return {
    addNote: (p, orderId, comment) => orders.comment(p, orderId, comment),
    erp,
    findOrder: findOrderByIncrementId,
    getOrder: getOrderByIncrementId,
    logger,
    setExtOrderId,
    settingsFor,
  };
}
