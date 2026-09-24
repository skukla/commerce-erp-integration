/*
 * The Commerce events this app subscribes to (app.commerce.config.ts), named once.
 *
 * Every write to the ERP that one of them triggers carries `origin: { event }`, so the
 * ERP's Events log can show what arrived from Commerce and which change brought it.
 * Without it, a change that reached the ERP left no trace on the screen an SC checks
 * (2026-09-18: a product rename arrived and nothing said so).
 */
export const COMMERCE_EVENTS = {
  // Fires before the commit (no "_commit_after" variant exists for these two, read in the
  // events reference 2026-09-24), so the record may not be readable yet when it arrives;
  // the handlers answer 503 to be delivered again when a read finds nothing.
  invoiceSaved: "observer.sales_order_invoice_save_after",
  orderSaved: "observer.sales_order_save_commit_after",
  productDeleted: "observer.catalog_product_delete_commit_after",
  productSaved: "observer.catalog_product_save_commit_after",
  shipmentSaved: "observer.sales_order_shipment_save_after",
  stockItemSaved: "observer.cataloginventory_stock_item_save_commit_after",
};

/**
 * The `origin` an ERP write carries for one of those events: the event's name and,
 * when the action was given one, the event's own id — the one id Commerce, I/O Events
 * and the ERP's log then share.
 *
 * `params.id` is the CloudEvent `id` I/O Events delivers with every event (the
 * CloudEvents spec requires it, and Adobe's delivery example shows it at the top level
 * beside `data`, which is where these actions already read `data` from). Not yet seen
 * in a live delivery to these actions, so it is optional: without it the ERP still
 * journals the event, just without the id.
 *
 * @param {string} event the Commerce event name
 * @param {object} [params] the action params, carrying the delivered CloudEvent
 */
export function originOf(event, params) {
  const id = params?.id;
  return typeof id === "string" && id ? { event, eventId: id } : { event };
}
