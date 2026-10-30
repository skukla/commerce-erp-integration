/*
 * Close the orders of some stores only (erp/close-orders, owner 2026-10-30). Demo Builder's store
 * wipe clears an ERP-served store in one call here, so the ERP never hears of its orders, then
 * fills the ERP from Commerce again. Every order placed in the stores' views is closed by the one
 * reset rule, with the same code and the same mark-before-write the whole reset uses
 * (lib/close-orders.js): canceled, refunded, or noted; its returns closed; its parts record, ERP
 * number and hold forgotten. Nothing else: every other order is left as it is, the ERP is not
 * wiped, and the ledgered company, product and price writes are not undone (that stays the whole
 * reset's, erp/detach).
 *
 * Every order in the views is closed, not only those an ERP holds: one an ERP never got would
 * otherwise be sent as new by the first save the wipe makes to it (order-commerce/created reads
 * an order with no ERP number and no parts record as never sent), and the mark is what stops it.
 */
import { closeOrders, prepareCloseOf } from "#lib/close-orders";
import { viewsInScope } from "#lib/store-scope";

/**
 * The store views a scope covers, and the codes the store does not have.
 * @param {object} params action params
 * @param {{ stores: string[], websites: string[] }} scope the codes named (lib/store-scope.js)
 * @param {{ storeScope: { readStoreStructure: Function } }} deps
 * @returns {Promise<{ viewIds: number[], unknown: string[] }>}
 */
export async function resolveScope(params, scope, deps) {
  return viewsInScope(await deps.storeScope.readStoreStructure(params), scope);
}

/**
 * Close every order placed in these store views.
 * @param {object} params action params
 * @param {{ stores: string[], websites: string[] }} scope the codes named, echoed in the answer
 * @param {number[]} viewIds the views they cover (resolveScope)
 * @param {object} deps `{ commerce, orderClient, orderParts, storeScope: { orderIdsInViews },
 *   today() }`
 * @returns {Promise<{ scope: object, closed: object, touched: object[], orders: object,
 *   holds: object }>} `closed` as the whole reset counts it; `touched` each order and what was
 *   done to it
 */
export async function closeStoreOrders(params, scope, viewIds, deps) {
  const ids = await deps.storeScope.orderIdsInViews(params, viewIds);
  const prepared = await prepareCloseOf(params, ids, deps);
  const done = {
    cleared: new Set(),
    holds: { failed: [], released: 0 },
    orders: { cleared: 0, failed: [] },
    touched: [],
  };
  const closed = await closeOrders(params, prepared, deps, done);
  return {
    closed,
    holds: done.holds,
    orders: done.orders,
    scope: { ...scope, storeViewIds: viewIds },
    touched: done.touched,
  };
}
