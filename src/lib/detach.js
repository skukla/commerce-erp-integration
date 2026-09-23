/*
 * Undo what this integration wrote onto Commerce: the company credit limits and blocks,
 * and the product names, prices and stock the ERP decided (all from the ledger), plus the ERP
 * order numbers on orders (from the ERP's own order list). Reset runs it before wiping
 * the ERP; removing the integration runs it before the uninstall.
 *
 * Commerce is the permanent system in a demo and the ERP is transient (owner,
 * 2026-09-23), so the rule is: everything the ERP wrote that Commerce CAN undo goes
 * back. What stays is what Commerce itself cannot delete — notes in order histories,
 * shipments, invoices and cancellations. Orders are the stated exception: Commerce has
 * no API to delete one, so the ERP's number is cleared instead.
 */

/**
 * @param {object} deps `{ commerce: { clearExtOrderId, setCompanyCreditLimit, setCompanyStatus, setProductName, setProductPrice, setStock }, erp: { listOrders }, ledger: { revertLedger } }`
 * @returns {Promise<{ reverted: object, orders: { cleared: number, failed: object[] } }>}
 */
export async function detach(params, deps) {
  const { commerce, erp, ledger } = deps;
  const reverted = await ledger.revertLedger({
    creditLimit: (companyId, creditId, before) =>
      commerce.setCompanyCreditLimit(params, creditId, companyId, before),
    name: (sku, before) => commerce.setProductName(params, sku, before),
    price: (sku, before) => commerce.setProductPrice(params, sku, before),
    status: (companyId, before) =>
      commerce.setCompanyStatus(params, companyId, before),
    stock: (sku, source, before) =>
      commerce.setStock(params, sku, before, source),
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
