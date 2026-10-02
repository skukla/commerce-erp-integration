/**
 * An ERP status event becomes a status-history line on the Commerce order.
 *
 * @param {object} params - the event (`data`: { id, status, erpNumber?, notifyCustomer? })
 * @param {string} [erpName] - the ERP that spoke, with several ERPs: both confirm one order,
 *   often under the same number, so the comment names which (AB-56)
 * @returns {{ statusHistory: object }}
 */
function transformData(params, erpName) {
  const erp = params.data.erpNumber
    ? ` (ERP sales order ${params.data.erpNumber})`
    : "";
  return {
    statusHistory: {
      comment: `Order ${params.data.status} in ${erpName || "the ERP"}${erp}`,
      is_customer_notified: params.data?.notifyCustomer ? 1 : 0,
      is_visible_on_front: 0,
    },
  };
}

export { transformData };
