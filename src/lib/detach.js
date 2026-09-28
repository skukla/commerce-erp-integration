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
 */
import { paramsForErp } from "#adapters/contract";

/**
 * @param {object} deps `{ erps?, commerce: { clearExtOrderId, unholdIfHeld, setCompanyCreditLimit, setCompanyStatus, setProductName, setProductPrice, setStock }, erp: { listOrders }, ledger: { revertLedger }, tierPrices: { revertTierPrice } }`
 * @returns {Promise<{ reverted: object, orders: { cleared: number, failed: object[] }, holds: { released: number, failed: object[] } }>}
 */
export async function detach(params, deps) {
  const { commerce, erp, ledger, tierPrices } = deps;
  const reverted = await ledger.revertLedger({
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
  });
  const orders = { cleared: 0, failed: [] };
  const holds = { failed: [], released: 0 };
  const cleared = new Set();
  for (const target of erpTargets(params, deps.erps)) {
    // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, few ERPs
    const listed = await erp.listOrders(target.params);
    if (!listed.ok) {
      orders.failed.push({
        error: `${target.label} orders answered ${listed.status}`,
        orderId: "*",
      });
      continue;
    }
    await undoOrders(params, listed.data.items ?? [], commerce, {
      cleared,
      holds,
      orders,
    });
  }
  return { holds, orders, reverted };
}

/**
 * The ERPs whose orders detach reads. It undoes what the integration wrote for every ERP it
 * serves, so with several ERPs each is read at its own address with its own credential; with one,
 * the integration's own params, as before.
 */
function erpTargets(params, erps) {
  if (!erps || erps.length <= 1) {
    return [{ label: "ERP", params }];
  }
  return erps.map((entry) => ({
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
