/*
 * The ONE reset rule for orders (owner, 2026-10-30), shared with Demo Builder's store wipe
 * (demo-builder-vscode src/features/data-installer/services/demoDataWipe/wipeOrders.ts): a reset
 * resets everything. Commerce cannot delete an order, so each one is closed off:
 *
 * 1. nothing invoiced and nothing shipped, in a state Commerce can cancel from: canceled, noted
 *    "Canceled by the demo reset on <day>.";
 * 2. any other order not already canceled or closed: what is invoiced is refunded with an offline
 *    credit memo, so the order becomes Closed, noted "Refunded and closed by the demo reset on
 *    <day>."; read back, an order Commerce kept open (a line never invoiced) is noted "Refunded
 *    the invoiced items by the demo reset on <day>." instead;
 * 3. its open returns: Closed (lib/close-orders.js);
 * 4. run twice, nothing new: an order whose history carries RESET_NOTE was handled before;
 * 5. an order Commerce can neither cancel nor credit (shipped but never invoiced; in payment
 *    review) is left open, noted "The ERP documents for this order were removed by the demo reset
 *    on <day>." and counted.
 *
 * Pure: it decides from the order as `GET orders/{id}` answers it. Commerce's answer to each call
 * is still the last word.
 *
 * Changing (owner, 2026-11-11): step 5's "shipped but never invoiced" is invoiced, then refunded,
 * so it ends Closed; and Demo Builder's Clear stops handing orders to this app. Read
 * docs/order-close-ownership.md before changing this file.
 */

/** Words every one of the reset's notes carries; an order whose history holds them was handled. */
export const RESET_NOTE = "by the demo reset on";

export const cancelledNote = (day) => `Canceled by the demo reset on ${day}.`;
export const refundedNote = (day) =>
  `Refunded and closed by the demo reset on ${day}.`;
/** A refund Commerce kept open: a line was never invoiced, so the order still has some to bill. */
export const refundedOpenNote = (day) =>
  `Refunded the invoiced items by the demo reset on ${day}.`;
export const removedNote = (day) =>
  `The ERP documents for this order were removed by the demo reset on ${day}.`;

/*
 * The states in which Commerce's Order::canCancel() refuses, whatever the lines say (Magento
 * 2.4-develop, app/code/Magento/Sales/Model/Order.php canCancel and _canVoidOrder; POST
 * orders/{id}/cancel answers false for them, Model/Service/OrderService.php cancelOrder). On hold
 * is also one, but the close takes an order off hold first.
 */
const UNCANCELLABLE_STATES = new Set([
  "canceled",
  "closed",
  "complete",
  "payment_review",
]);

/** The states an order is already closed off in: the rule leaves it untouched. */
const FINISHED_STATES = new Set(["canceled", "closed"]);

/*
 * A state Order::canCreditmemo() refuses in beyond the finished ones (Order.php: payment review;
 * on hold too, but the close takes an order off hold first).
 */
const UNCREDITABLE_STATES = new Set(["payment_review"]);

/** Return statuses that are already closed (Adobe's "Closed" and "Processed and Closed"). */
const CLOSED_RETURNS = new Set(["closed", "processed_closed"]);

const qty = (value) => Number(value ?? 0);
const linesOf = (order) =>
  Array.isArray(order.items) ? order.items : Object.values(order.items ?? {});
/** A configurable's child line follows its parent: Commerce credits the parent line. */
const topLines = (order) =>
  linesOf(order).filter(
    (i) => i.parent_item_id === undefined || i.parent_item_id === null,
  );

/**
 * Whether the reset cancels this order: the owner's rule, nothing invoiced and nothing shipped,
 * inside Commerce's own (a state it can cancel from, something left to invoice: canCancel answers
 * false when every line is invoiced, Order.php).
 * @param {object} order the order as `GET orders/{id}` answers it
 */
export function cancellableByReset(order) {
  if (UNCANCELLABLE_STATES.has(order.state)) {
    return false;
  }
  const items = linesOf(order);
  if (items.some((i) => qty(i.qty_invoiced) > 0 || qty(i.qty_shipped) > 0)) {
    return false;
  }
  return items.some((i) => qty(i.qty_ordered) - qty(i.qty_canceled) > 0);
}

/**
 * The offline credit memo that refunds what is invoiced and not yet refunded: every top line's
 * invoiced quantity, and the shipping invoiced and not refunded (Commerce's own fields; a refund
 * of every invoiced line and all its shipping is what lets Commerce close the order). Nothing is
 * returned to stock (the ERP owns stock and the reset refills it). Null when nothing is left to
 * refund: an offline credit memo credits only what an invoice billed.
 *
 * The body of POST order/{orderId}/refund, the route Adobe documents as "Issues an offline
 * refund" (developer.adobe.com/commerce/webapi/rest/tutorials/orders/order-issue-refund/, read
 * 2026-10-30). It has no `isOnline` field: that is POST invoice/{invoiceId}/refund's, the online
 * refund, so the order route is offline by itself and none is sent.
 * @param {object} order the order as `GET orders/{id}` answers it
 * @returns {{ items: object[], notify: false, arguments: object } | null}
 */
export function refundOf(order) {
  const items = topLines(order)
    .map((i) => ({
      order_item_id: Number(i.item_id),
      qty: qty(i.qty_invoiced) - qty(i.qty_refunded),
    }))
    .filter((i) => i.qty > 0 && Number.isFinite(i.order_item_id));
  if (items.length === 0) {
    return null;
  }
  const shipping = Math.max(
    0,
    qty(order.base_shipping_invoiced) - qty(order.base_shipping_refunded),
  );
  return {
    arguments: {
      adjustment_negative: 0,
      adjustment_positive: 0,
      shipping_amount: shipping,
    },
    items,
    notify: false,
  };
}

/**
 * What the rule does to one order (its history's reset note is checked by the caller):
 * `untouched` (already canceled or closed), `cancel`, `refund`, or `stuck` (neither is possible).
 * @param {object} order the order as `GET orders/{id}` answers it
 * @returns {"untouched"|"cancel"|"refund"|"stuck"}
 */
export function resetStepOf(order) {
  if (FINISHED_STATES.has(order.state)) {
    return "untouched";
  }
  if (cancellableByReset(order)) {
    return "cancel";
  }
  if (!UNCREDITABLE_STATES.has(order.state) && refundOf(order)) {
    return "refund";
  }
  return "stuck";
}

/** Whether an order's history already carries a reset's note (it was handled before). */
export const hasResetNote = (order) =>
  (order.status_histories ?? []).some((h) =>
    String(h?.comment ?? "").includes(RESET_NOTE),
  );

/** The returns not closed yet. */
export const openReturns = (returns) =>
  (returns ?? []).filter((r) => !CLOSED_RETURNS.has(String(r?.status ?? "")));
