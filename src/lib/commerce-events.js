/*
 * The Commerce events this app subscribes to (app.commerce.config.ts), named once.
 *
 * Every write to the ERP that one of them triggers carries an `origin` naming the sending
 * system and its document in plain words (the ERP's contract version 16:
 * `{ system, document, eventId? }`), so the ERP's Events log can show what arrived and from
 * where, and the ERP raises no event of its own for a change Commerce already made. Commerce's
 * event names stay here: the ERP is not told this app's vocabulary.
 * Without an origin, a change that reached the ERP left no trace on the screen an SC checks
 * (2026-09-18: a product rename arrived and nothing said so).
 */
export const COMMERCE_EVENTS = {
  // Fires before the commit (no "_commit_after" variant exists for these two, read in the
  // events reference 2026-09-24), so the record may not be readable yet when it arrives;
  // the handlers answer 503 to be delivered again when a read finds nothing.
  companySaved: "observer.company_save_commit_after",
  invoiceSaved: "observer.sales_order_invoice_save_after",
  orderSaved: "observer.sales_order_save_commit_after",
  productDeleted: "observer.catalog_product_delete_commit_after",
  productSaved: "observer.catalog_product_save_commit_after",
  // A return (RMA) saved: in the store's supported events, read live 2026-10-02.
  returnSaved: "observer.rma_save_commit_after",
  shipmentSaved: "observer.sales_order_shipment_save_after",
  stockItemSaved: "observer.cataloginventory_stock_item_save_commit_after",
};

/** The system this app speaks for, as the ERP's journal names it. */
export const ORIGIN_SYSTEM = "Adobe Commerce";

/** What each event is, as a document word the ERP's journal can name it by. */
const DOCUMENTS = {
  [COMMERCE_EVENTS.companySaved]: "company",
  [COMMERCE_EVENTS.invoiceSaved]: "invoice",
  [COMMERCE_EVENTS.orderSaved]: "order",
  [COMMERCE_EVENTS.productDeleted]: "product",
  [COMMERCE_EVENTS.productSaved]: "product",
  [COMMERCE_EVENTS.returnSaved]: "return",
  [COMMERCE_EVENTS.shipmentSaved]: "shipment",
  [COMMERCE_EVENTS.stockItemSaved]: "stock item",
};

/**
 * The delivered event's own id on an origin, when the action was given one: the one id
 * Commerce, I/O Events and the ERP's log then share.
 *
 * `params.id` is the CloudEvent `id` I/O Events delivers with every event (the CloudEvents
 * spec requires it, and Adobe's delivery example shows it at the top level beside `data`,
 * which is where these actions already read `data` from). Not yet seen in a live delivery
 * to these actions, so it is optional: without it the ERP still journals the write.
 *
 * @param {{ system: string, document?: string }} origin
 * @param {object} [params] the action params, carrying the delivered CloudEvent
 */
export function withEventId(origin, params) {
  const id = params?.id;
  return typeof id === "string" && id ? { ...origin, eventId: id } : origin;
}

/**
 * The `origin` an ERP write carries for one of those events: this system, the document the
 * event was about (with its number when the caller knows it), and the delivered event's id.
 *
 * @param {string} event the Commerce event name (COMMERCE_EVENTS)
 * @param {object} [params] the action params, carrying the delivered CloudEvent
 * @param {string|number} [number] the document's own number, when known
 */
export function originOf(event, params, number) {
  const noun = DOCUMENTS[event] ?? "change";
  const document =
    number === undefined || number === null || number === ""
      ? noun
      : `${noun} ${number}`;
  return withEventId({ document, system: ORIGIN_SYSTEM }, params);
}
