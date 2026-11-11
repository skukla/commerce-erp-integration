/*
 * The answer every Commerce order event gives for an order a demo reset closed (the one reset
 * rule, lib/reset-rule.js). Each write a reset makes to an order (its note, a return closed, a hold
 * released, a cancel, an invoice, a refund, the ERP number cleared) raises an event (order saved,
 * invoice saved, return saved) whose handler asks here first and tells no ERP: the order is being
 * closed off, and a refunded order with no ERP number and no parts record would otherwise read as
 * a new order never sent.
 *
 * An order counts as closed by a reset when either is true:
 * - this app's own reset marked it in State before its first write (lib/close-orders.js,
 *   lib/order-parts.js markClosedByReset);
 * - its Commerce status history carries RESET_NOTE ("by the demo reset on"). Demo Builder's Clear
 *   closes orders in Commerce itself and leaves no mark here (owner, 2026-11-11,
 *   docs/order-close-ownership.md), but it writes its reset note before its first write to an
 *   order, so every event it raises already finds the note. The history is taken from the event
 *   when it carries one, else from the order read from Commerce; a read that fails answers null,
 *   so the event goes on as before.
 */
import { getOrderByIncrementId } from "#lib/commerce";
import { closedByReset } from "#lib/order-parts";
import { resetNoteDayOf } from "#lib/reset-rule";

const OK = 200;

const skipped = (incrementId, day) => ({
  message: `order ${incrementId} was closed by the demo reset on ${day}; it is not sent to any ERP.`,
  outcome: "skipped",
  statusCode: OK,
});

/** The day of the reset note in the history the event carries, or in the order as read. */
async function noteDayOf(params, order, readOrder) {
  if (Array.isArray(order.status_histories)) {
    return resetNoteDayOf(order);
  }
  try {
    const read = await readOrder(params, order.increment_id);
    return read ? resetNoteDayOf(read) : null;
  } catch {
    return null;
  }
}

/**
 * For an order save event, which names the order by its number.
 * @param {object} params action params
 * @param {object|undefined} order the event's order (its `increment_id`; `status_histories`
 *   when the event carries them)
 * @param {(params: object, incrementId: string) => Promise<object|null>} [readOrder] the order
 *   by its number (lib/commerce.js getOrderByIncrementId)
 * @returns {Promise<null | { outcome: "skipped", statusCode: number, message: string }>} the
 *   answer that ends the delivery for a reset-closed order, or null for any other
 */
export async function resetClosedAnswer(
  params,
  order,
  readOrder = getOrderByIncrementId,
) {
  const incrementId = order?.increment_id;
  if (!incrementId) {
    return null;
  }
  const mark = await closedByReset(incrementId);
  if (mark) {
    return skipped(incrementId, mark.day);
  }
  const day = await noteDayOf(params, order, readOrder);
  return day ? skipped(incrementId, day) : null;
}

/**
 * The same answer for an event that names the order only by its entity id (an invoice, a
 * shipment, a return): the order is read whole, for its number and its history. A read that
 * fails answers null, so the event goes on as before (it needs the same order next, and fails
 * there the way it always has).
 * @param {object} params action params
 * @param {number|string|undefined} orderId the order's entity id
 * @param {(params: object, orderId: number) => Promise<object>} getOrder GET orders/{id}
 */
export async function resetClosedAnswerOfOrder(params, orderId, getOrder) {
  const id = Number(orderId);
  if (!(Number.isFinite(id) && id > 0)) {
    return null;
  }
  try {
    const order = await getOrder(params, id);
    const incrementId = order?.increment_id;
    if (!incrementId) {
      return null;
    }
    const mark = await closedByReset(incrementId);
    const day = mark?.day ?? resetNoteDayOf(order);
    return day ? skipped(incrementId, day) : null;
  } catch {
    return null;
  }
}
