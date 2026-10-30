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
 *
 * The ERP is transient too (owner, 2026-10-30): once Commerce is closed, each ERP that held one
 * of the orders is asked to remove its own sales orders for them, with their invoices, shipments
 * and everything pointing at them (admin/remove-orders, contract version 23), keeping the rest:
 * it may serve another demo's store. Which ERP held which order is read from the orders' parts
 * records BEFORE the close forgets them. An ERP from before version 23 answers 404 and is named
 * `unsupported`; one that cannot be asked is named with why. Neither stops the Commerce close.
 */
import { paramsForErp } from "#adapters/contract";
import { closeOrders, prepareCloseOf } from "#lib/close-orders";
import { viewsInScope } from "#lib/store-scope";

const NOT_FOUND = 404;

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
 * Which ERP holds each order, before the close forgets it: the ERPs its parts record names. An
 * order with no parts record but an ERP number (sent before parts records existed) may be any
 * listed ERP's, so every one is asked; an ERP answers a reference it does not have as notFound.
 * @returns {Promise<Map<string, string[]>>} ERP id → the web shop order numbers it holds
 */
async function holdersOf(orders, deps) {
  const byErp = new Map();
  const add = (erpId, reference) =>
    byErp.set(erpId, [...(byErp.get(erpId) ?? []), reference]);
  for (const order of orders) {
    const reference = String(order.increment_id);
    // biome-ignore lint/performance/noAwaitInLoops: one small record per order, in order
    const { parts } = await deps.orderParts.readOrderParts(reference);
    const held = Object.keys(parts ?? {});
    if (held.length > 0) {
      for (const erpId of held) {
        add(erpId, reference);
      }
    } else if (order.ext_order_id) {
      for (const entry of deps.erps) {
        add(entry.id, reference);
      }
    }
  }
  return byErp;
}

/** One ERP's answer to the removal, in the close's words. */
async function removeIn(params, entry, references, deps) {
  try {
    const res = await deps.erp.removeOrders(
      paramsForErp(params, entry),
      references,
    );
    if (res.ok) {
      return {
        notFound: res.data?.references?.notFound ?? [],
        removed: res.data?.removed ?? {},
      };
    }
    return res.status === NOT_FOUND
      ? "unsupported"
      : { failed: `the ERP answered ${res.status}` };
  } catch (error) {
    return { failed: error.message };
  }
}

/** Ask each ERP that held an order to remove its sales orders for them. */
async function removeFromErps(params, byErp, deps) {
  const answers = {};
  for (const [erpId, references] of byErp) {
    const entry = deps.erps.find((e) => e.id === erpId);
    answers[erpId] = entry
      ? // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, few ERPs
        await removeIn(params, entry, references, deps)
      : { failed: `no ERP ${erpId} in the list` };
  }
  return answers;
}

/**
 * Close every order placed in these store views.
 * @param {object} params action params
 * @param {{ stores: string[], websites: string[] }} scope the codes named, echoed in the answer
 * @param {number[]} viewIds the views they cover (resolveScope)
 * @param {object} deps `{ commerce, orderClient, orderParts, storeScope: { orderIdsInViews },
 *   erp: { removeOrders }, erps, today() }`
 * @returns {Promise<{ scope: object, closed: object, touched: object[], erpRemoved: object,
 *   orders: object, holds: object }>} `closed` as the whole reset counts it; `touched` each order
 *   and what was done to it; `erpRemoved` each ERP that held one: `{ removed, notFound }`,
 *   `"unsupported"` or `{ failed }`
 */
export async function closeStoreOrders(params, scope, viewIds, deps) {
  const ids = await deps.storeScope.orderIdsInViews(params, viewIds);
  const prepared = await prepareCloseOf(params, ids, deps);
  const byErp = await holdersOf(prepared.orders, deps);
  const done = {
    cleared: new Set(),
    holds: { failed: [], released: 0 },
    orders: { cleared: 0, failed: [] },
    touched: [],
  };
  const closed = await closeOrders(params, prepared, deps, done);
  const erpRemoved = await removeFromErps(params, byErp, deps);
  return {
    closed,
    erpRemoved,
    holds: done.holds,
    orders: done.orders,
    scope: { ...scope, storeViewIds: viewIds },
    touched: done.touched,
  };
}
