/*
 * Undo what this integration wrote onto Commerce that Commerce cannot undo itself:
 * the company credit limits and blocks (from the ledger) and the ERP order numbers on
 * orders (from the ERP's own order list). Reset runs it before wiping the ERP; removing
 * the integration runs it before the uninstall. Notes in order histories, shipments,
 * invoices and cancellations stay: Commerce cannot delete them.
 */

/**
 * @param {object} deps `{ commerce: { clearExtOrderId, setCompanyCreditLimit, setCompanyStatus }, erp: { listOrders }, ledger: { revertLedger } }`
 * @returns {Promise<{ reverted: object, orders: { cleared: number, failed: object[] } }>}
 */
export async function detach(params, deps) {
  const { commerce, erp, ledger } = deps;
  const reverted = await ledger.revertLedger({
    creditLimit: (companyId, creditId, before) =>
      commerce.setCompanyCreditLimit(params, creditId, companyId, before),
    status: (companyId, before) =>
      commerce.setCompanyStatus(params, companyId, before),
  });
  const orders = { cleared: 0, failed: [] };
  const listed = await erp.listOrders(params);
  if (!listed.ok) {
    orders.failed.push({
      error: `ERP orders answered ${listed.status}`,
      orderId: "*",
    });
    return { orders, reverted };
  }
  for (const order of listed.data.items ?? []) {
    if (!order.commerceOrderId) {
      continue;
    }
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
  return { orders, reverted };
}
