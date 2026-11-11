/*
 * The ONE reset rule for orders (owner, 2026-10-30; changed 2026-11-11), shared with Demo
 * Builder's Clear (demo-builder-vscode src/features/data-installer/services/demoDataWipe/
 * wipeOrders.ts, which must say the same). Commerce cannot delete an order, so each one is closed
 * off, and every order ends Canceled or Closed except one in payment review:
 *
 * | The order | What it gets | Its note |
 * |---|---|---|
 * | already Canceled or Closed | nothing (`done`) | none |
 * | nothing invoiced, nothing shipped, a state Commerce can cancel from | canceled | `cancelledNote`; `removedNote` added when Commerce answers the cancel with anything but `true` |
 * | in payment review (Commerce refuses an invoice and a credit memo there) | only the note | `removedNote` |
 * | anything else with something to invoice or refund | what is not invoiced is invoiced (every remaining line), then everything invoiced is refunded offline, so Commerce closes it | `refundedNote`; `refundedOpenNote` added when the order does not then read Closed |
 * | anything else, with nothing to invoice or refund | only the note | `removedNote` |
 *
 * Why invoice first (Experience League, read 2026-11-11, docs/order-close-ownership.md): an order
 * is Closed once it has a credit memo and the customer was refunded; a credit memo needs an
 * invoice; an offline refund works for any payment method.
 *
 * The note comes FIRST, decided from the plan up front (`leadingNoteOf`), before an order's
 * returns are closed, its hold released, or it is canceled, invoiced or refunded: every handler of
 * the events those writes raise treats an order whose history carries RESET_NOTE as closed by a
 * reset and tells no ERP (lib/reset-closed.js). When Commerce's answer then differs, ONE
 * correcting note is added, so Commerce's answer stays the last word.
 *
 * Run twice, nothing new: an order is `done` when Canceled or Closed, or when its history carries
 * the left-open note (LEFT_OPEN_NOTE). One carrying another reset note but not closed (a run
 * stopped after its note) is planned again, marked `noted`, so it gets no second leading note.
 *
 * Pure: it decides from the order as `GET orders/{id}` answers it. Read
 * docs/order-close-ownership.md before changing this file.
 */

/** Words every one of the reset's notes carries; an order whose history holds them was handled. */
export const RESET_NOTE = "by the demo reset on";

export const cancelledNote = (day) => `Canceled by the demo reset on ${day}.`;
export const refundedNote = (day) =>
  `Refunded and closed by the demo reset on ${day}.`;
/** The correcting note when a refunded order does not then read Closed. */
export const refundedOpenNote = (day) =>
  `Refunded the invoiced items by the demo reset on ${day}.`;
/** The words only the left-open note carries: an order whose history holds them is finished with. */
export const LEFT_OPEN_NOTE =
  "The ERP documents for this order were removed by the demo reset on";
export const removedNote = (day) => `${LEFT_OPEN_NOTE} ${day}.`;

/**
 * The note an order's work starts with, decided from its plan before anything is written.
 * @param {"cancel"|"refund"|"note"} action the plan's action
 * @param {string} day the day the note names
 */
export function leadingNoteOf(action, day) {
  if (action === "cancel") {
    return cancelledNote(day);
  }
  return action === "refund" ? refundedNote(day) : removedNote(day);
}

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
 * A state Order::canCreditmemo() and Order::canInvoice() refuse in beyond the finished ones
 * (Order.php: payment review; on hold too, but the close takes an order off hold first).
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

const historyHas = (order, words) =>
  (order.status_histories ?? []).some((h) =>
    String(h?.comment ?? "").includes(words),
  );

/** Whether an order's history already carries a reset's note. */
export const hasResetNote = (order) => historyHas(order, RESET_NOTE);

const RESET_DAY = new RegExp(`${RESET_NOTE} (\\d{4}-\\d{2}-\\d{2})`, "u");

/**
 * The day the newest reset note in an order's history names (Commerce answers the history newest
 * first), or null when it carries none.
 * @param {object} order an order with `status_histories`
 * @returns {string|null}
 */
export function resetNoteDayOf(order) {
  for (const h of order.status_histories ?? []) {
    const day = String(h?.comment ?? "").match(RESET_DAY)?.[1];
    if (day) {
      return day;
    }
  }
  return null;
}

/** Whether any line still has something neither invoiced nor canceled. */
const notAllInvoiced = (order) =>
  linesOf(order).some(
    (i) => qty(i.qty_ordered) - qty(i.qty_invoiced) - qty(i.qty_canceled) > 0,
  );

/** Canceled when it can be; else, outside payment review, invoiced and refunded when there is anything to; else only noted. */
function actionOf(order) {
  if (cancellableByReset(order)) {
    return { action: "cancel", invoice: false };
  }
  if (UNCREDITABLE_STATES.has(order.state)) {
    return { action: "note", invoice: false };
  }
  const invoice = notAllInvoiced(order);
  return invoice || refundOf(order)
    ? { action: "refund", invoice }
    : { action: "note", invoice: false };
}

/**
 * What closing one order takes, or `"done"` when it is Canceled or Closed, or a reset left it open
 * before.
 * @param {object} order the order as `GET orders/{id}` answers it
 * @returns {"done" | { action: "cancel"|"refund"|"note", invoice: boolean, noted: boolean,
 *   unhold: boolean }} `invoice`: for a refund, something is not yet invoiced, so the order is
 *   invoiced in full first; `noted`: its history already carries a reset note (no second leading
 *   note); `unhold`: it is on hold, so it is released first
 */
export function resetPlanOf(order) {
  if (FINISHED_STATES.has(order.state) || historyHas(order, LEFT_OPEN_NOTE)) {
    return "done";
  }
  return {
    ...actionOf(order),
    noted: hasResetNote(order),
    unhold: order.state === "holded",
  };
}

/** The returns not closed yet. */
export const openReturns = (returns) =>
  (returns ?? []).filter((r) => !CLOSED_RETURNS.has(String(r?.status ?? "")));
