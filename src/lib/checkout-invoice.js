/*
 * The invoice Commerce makes at checkout (AB-66). A card paid with Authorize and Capture makes
 * Commerce invoice the whole order there and then, and raise Invoice Saved for it. Passed to an
 * ERP, that invoice asks the ERP to invoice an order it may not have confirmed yet (I/O Events
 * can deliver the event after the order reached the ERP): the ERP refuses ("Confirm the order
 * before invoicing it.") and the event fails. It is never an ERP's to hear: each ERP records the
 * card payment from the order's payment reference (lib/payment-reference.js) and invoices the
 * order itself when it has shipped it.
 *
 * How it is recognised, from what Commerce answers rather than what the event carries (the
 * Invoice Saved subscription names entity_id, order_id, increment_id and state only,
 * app.commerce.config.ts; adding a field would need a redeploy and a reinstall):
 *
 * - the order's payment was captured: a payment reference, so an amount paid and a gateway
 *   transaction (paymentReferenceOf). Nothing captured, no checkout invoice; the invoice is not
 *   even read;
 * - the invoice was made with the order: its `created_at` within CHECKOUT_SECONDS of the
 *   order's. The checkout invoice is saved in the same request as the order.
 *
 * Why not the other fields. The payment alone does not tell: a card authorized at checkout and
 * captured later by a merchant's invoice reads captured too, and that invoice is the merchant's.
 * Nor does "the order's first invoice", for the same reason. The capture case is set by the
 * Admin invoice form while invoicing and is not a stored invoice field, so a read does not
 * carry it; the event would only with a subscription change, unproven live, so it is not used. The
 * part record's `invoicedBefore` is written only when an ERP's own invoice comes back, after
 * this event. Anything unreadable answers null: today's path decides, as before.
 */
import { paymentReferenceOf } from "#lib/payment-reference";

/** How long after the order its checkout invoice can be saved; a person in Admin is slower. */
const CHECKOUT_SECONDS = 60;
const MS_PER_SECOND = 1000;
const OK = 200;

/** Commerce's REST time ("2026-09-24 10:00:00", UTC) in milliseconds; NaN when unreadable. */
function timeOf(value) {
  return typeof value === "string"
    ? Date.parse(`${value.trim().replace(" ", "T")}Z`)
    : Number.NaN;
}

/** Whether the invoice was saved with the order, at checkout. */
function madeWithOrder(orderCreatedAt, invoiceCreatedAt) {
  const apart = Math.abs(timeOf(invoiceCreatedAt) - timeOf(orderCreatedAt));
  return apart <= CHECKOUT_SECONDS * MS_PER_SECOND;
}

const hasId = (id) => id !== undefined && id !== null;

/**
 * The answer for an Invoice Saved event about the invoice Commerce made at checkout, or null
 * for any other invoice (today's path handles it).
 * @param {object} params action params
 * @param {{ entity_id?: number, increment_id?: string, order_id?: number }} invoice the event's value
 * @param {{ getOrder: Function, getInvoice: Function }} deps the Commerce reads
 * @returns {Promise<null | {outcome: "done", statusCode: number, message: string, orderRef: string}>}
 */
export async function checkoutInvoiceOf(params, invoice, deps) {
  const orderId = Number(invoice?.order_id);
  if (!(Number.isFinite(orderId) && hasId(invoice?.entity_id))) {
    return null;
  }
  const order = await deps.getOrder(params, orderId);
  if (!order || paymentReferenceOf(order.payment) === null) {
    return null;
  }
  const read = await deps.getInvoice(params, Number(invoice.entity_id));
  if (!madeWithOrder(order.created_at, read?.created_at)) {
    return null;
  }
  return {
    message: `Commerce invoice ${invoice.increment_id ?? invoice.entity_id} was made at checkout, when the card payment was captured: no ERP is told of it, as each ERP records that payment from the order's payment reference.`,
    orderRef: String(order.increment_id),
    outcome: "done",
    statusCode: OK,
  };
}
