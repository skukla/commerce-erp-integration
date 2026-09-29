/**
 * An ERP shipment event becomes a Commerce shipment of the lines it names.
 *
 * @param {object} params - the event (`data`: { orderId, items[{orderItemId, qty}], erpNumber? })
 * @returns {object} the `POST order/{id}/ship` body
 */
function transformData(params) {
  const erp = params.data.erpNumber
    ? ` (ERP sales order ${params.data.erpNumber})`
    : "";
  return {
    comment: { comment: `Shipped from the ERP${erp}`, is_visible_on_front: 0 },
    // The MSI source goes under `arguments.extension_attributes.source_code`, NOT at the top
    // level — Commerce's salesShipOrder ignores a top-level extension_attributes, so a
    // non-default source (Bodea's `northwind`) was dropped and the ship 400'd from `default`.
    arguments: {
      extension_attributes: {
        source_code: params.data.stockSourceCode || "default",
      },
    },
    items: params.data.items.map((item) => ({
      order_item_id: item.orderItemId,
      qty: item.qty,
    })),
    notify: false,
    tracks: (params.data.tracks || []).map((t) => ({
      carrier_code: t.carrierCode,
      title: t.title,
      track_number: t.trackNumber,
    })),
  };
}

export { transformData };
