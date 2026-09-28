/*
 * Undo what this integration wrote onto Commerce: the company credit limits and blocks,
 * the product names, prices and stock the ERP decided, and the contract prices it wrote into
 * companies' shared catalogs as tier prices (all from the ledger), plus the ERP
 * order numbers on orders (from the ERP's own order list). Reset runs it before wiping
 * the ERP; removing the integration runs it before the uninstall.
 *
 * Commerce is the permanent system in a demo and the ERP is transient (owner,
 * 2026-09-23), so the rule is: everything the ERP wrote that Commerce CAN undo goes
 * back. What stays is what Commerce itself cannot delete — notes in order histories,
 * shipments, invoices and cancellations. Orders are the stated exception: Commerce has
 * no API to delete one, so the ERP's number is cleared instead — and an order the ERP
 * still holds for credit is taken off hold, since a hold is a state Commerce can undo.
 *
 * With one ERP named, only that ERP's writes are undone (lib/detach-erp.js), so one ERP can be
 * reset while the others keep theirs.
 */
import { paramsForErp } from "#adapters/contract";
import { closeOrders, prepareClose } from "#lib/close-orders";
import { revertErp } from "#lib/detach-erp";

/**
 * The ledger's writers: one per thing the ERP can change on Commerce (lib/ledger.js).
 * @param {object} params action params
 * @param {object} deps `{ commerce, tierPrices }`
 */
function ledgerWriters(params, { commerce, tierPrices }) {
  return {
    creditLimit: (companyId, creditId, before) =>
      commerce.setCompanyCreditLimit(params, creditId, companyId, before),
    customAttributes: (companyId, before) =>
      commerce.setCompanyCustomAttributes(params, companyId, before),
    name: (sku, before) => commerce.setProductName(params, sku, before),
    price: (sku, before) => commerce.setProductPrice(params, sku, before),
    // Nothing writes a company status any more (an ERP's block holds its orders instead,
    // owner 2026-09-28), but installs from before that change hold ledger entries for a
    // status they did write. Undoing that existing data is what detach is for, so this stays.
    status: (companyId, before) =>
      commerce.setCompanyStatus(params, companyId, before),
    stock: (sku, source, before) =>
      commerce.setStock(params, sku, before, source),
    tierPrice: (entry) => tierPrices.revertTierPrice(params, entry),
  };
}

/**
 * Undo what the integration wrote on Commerce: for every ERP, or with `params.erp` for that
 * one ERP only (AB-16c: its ledger entries, its share of each company's credit, and its own
 * orders), leaving the other ERPs' writes. The caller checks the id is listed (erp/detach).
 *
 * With `params.closeOrders` (a whole detach only; the caller refuses it with `erp`), every order
 * the ERPs hold is closed off too, before a reset wipes them (lib/close-orders.js, AB-16n): each
 * is marked closed before the first Commerce write, and the answer carries `closed`.
 *
 * @param {object} params action params; `erp` the one ERP to undo; `closeOrders` true to close
 * @param {object} deps `{ erps?, commerce: { clearExtOrderId, unholdIfHeld, getCompany, setCompanyCreditLimit, setCompanyCustomAttributes, setCompanyStatus, setProductName, setProductPrice, setStock, findOrderByIncrementId, orders: { get, cancel, comment } }, erp: { listOrders }, ledger, tierPrices: { revertTierPrice }, orderParts?, today? }`
 * @returns {Promise<{ erp?: string, reverted: object, orders: { cleared: number, failed: object[] }, holds: { released: number, failed: object[] }, closed?: object }>}
 */
export async function detach(params, deps) {
  const { commerce, ledger } = deps;
  const erpId = params.erp ? String(params.erp) : undefined;
  const closing = params.closeOrders === true && erpId === undefined;
  const writers = ledgerWriters(params, deps);
  const reverted = erpId
    ? await revertErp(params, erpId, writers, deps)
    : await ledger.revertLedger(writers);
  const orders = { cleared: 0, failed: [] };
  const holds = { failed: [], released: 0 };
  const cleared = new Set();
  const listed = await listedOrders(params, deps, erpId, orders);
  const prepared = closing
    ? await prepareClose(
        params,
        listed.map((order) => order.commerceOrderId).filter(Boolean),
        closeDeps(deps),
      )
    : undefined;
  await undoOrders(params, listed, commerce, { cleared, holds, orders });
  const closed = prepared
    ? await closeOrders(params, prepared, closeDeps(deps), {
        cleared,
        holds,
        orders,
      })
    : undefined;
  const activity = closed
    ? await clearActivity(closed, closeDeps(deps))
    : undefined;
  return {
    ...(erpId ? { erp: erpId } : {}),
    ...(closed ? { closed } : {}),
    ...(activity ? { activity } : {}),
    holds,
    orders,
    reverted,
  };
}

/**
 * A reset starts the Admin page's Activity again (AB-16n): its history and scheduled-run records
 * describe ERP records the reset is about to wipe. They go, and one line says the reset happened
 * and what it closed. Only for a reset (closeOrders), never for removing the integration.
 */
async function clearActivity(closed, deps) {
  const { activity } = deps;
  if (!activity) {
    return;
  }
  const historyCleared = await activity.clearHistory();
  const scheduledCleared = await activity.clearScheduledRuns();
  await activity.recordReset(
    `Demo reset on ${deps.today()}: ${closed.cancelled} ${closed.cancelled === 1 ? "order" : "orders"} cancelled, ${closed.commented} noted as closed, the ERPs' changes in Commerce undone. The activity before it was cleared.`,
  );
  return { historyCleared, scheduledCleared };
}

/** What the close needs beyond detach's own collaborators: the day, UTC, as YYYY-MM-DD. */
function closeDeps(deps) {
  return {
    ...deps,
    today: deps.today ?? (() => new Date().toISOString().slice(0, 10)),
  };
}

/** Every order each ERP lists; a list that cannot be read is reported and the rest go on. */
async function listedOrders(params, deps, erpId, orders) {
  const items = [];
  for (const target of erpTargets(params, deps.erps, erpId)) {
    // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, few ERPs
    const listed = await deps.erp.listOrders(target.params);
    if (listed.ok) {
      items.push(...(listed.data.items ?? []));
    } else {
      orders.failed.push({
        error: `${target.label} orders answered ${listed.status}`,
        orderId: "*",
      });
    }
  }
  return items;
}

/**
 * The ERPs whose orders detach reads. It undoes what the integration wrote for every ERP it
 * serves, so with several ERPs each is read at its own address with its own credential; with one,
 * the integration's own params, as before. With one ERP named, only that ERP's orders: a split
 * order carries no ERP number, so an ERP's own list names every order it numbered.
 */
function erpTargets(params, erps, erpId) {
  if (!erps || erps.length <= 1) {
    return [{ label: "ERP", params }];
  }
  return erps
    .filter((entry) => erpId === undefined || entry.id === erpId)
    .map((entry) => ({
      label: entry.name,
      params: paramsForErp(params, entry),
    }));
}

/** Clear each order's ERP number once, and take off hold what the ERP holds for credit. */
async function undoOrders(params, items, commerce, { cleared, holds, orders }) {
  for (const order of items) {
    if (!order.commerceOrderId) {
      continue;
    }
    if (!cleared.has(order.commerceOrderId)) {
      cleared.add(order.commerceOrderId);
      try {
        // biome-ignore lint/performance/noAwaitInLoops: one order at a time, in order
        await commerce.clearExtOrderId(params, order.commerceOrderId);
        orders.cleared += 1;
      } catch (error) {
        orders.failed.push({
          error: error.message,
          orderId: order.commerceOrderId,
        });
      }
    }
    if (order.creditStatus !== "held") {
      continue;
    }
    try {
      if (await commerce.unholdIfHeld(params, order.commerceOrderId)) {
        holds.released += 1;
      }
    } catch (error) {
      holds.failed.push({
        error: error.message,
        orderId: order.commerceOrderId,
      });
    }
  }
}
