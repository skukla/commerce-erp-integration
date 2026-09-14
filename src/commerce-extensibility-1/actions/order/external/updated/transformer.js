/**
 * An ERP status event becomes a status-history line on the Commerce order.
 *
 * @param {object} params - the event (`data`: { id, status, erpNumber?, notifyCustomer? })
 * @returns {{ statusHistory: object }}
 */
function transformData(params) {
  const erp = params.data.erpNumber
    ? ` (ERP sales order ${params.data.erpNumber})`
    : "";
  return {
    statusHistory: {
      comment: `Order ${params.data.status} in the ERP${erp}`,
      is_customer_notified: params.data?.notifyCustomer ? 1 : 0,
      is_visible_on_front: 1,
    },
  };
}

export { transformData };
