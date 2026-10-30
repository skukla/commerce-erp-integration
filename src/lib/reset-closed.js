/*
 * The answer every Commerce order event gives for an order a demo reset closed (lib/close-orders.js,
 * the one reset rule). The reset marks each order in State before its first write
 * (lib/order-parts.js markClosedByReset), then cancels or refunds it, closes its returns, notes
 * it and clears its ERP number. Each of those writes raises an event (order saved, invoice saved,
 * return saved) whose handler reads the mark first and tells no ERP: the order's ERP documents
 * are about to be wiped, and without the mark a refunded order with no ERP number and no parts
 * record reads as a new order never sent.
 */
import { closedByReset } from "#lib/order-parts";

const OK = 200;

/**
 * @param {string|undefined} incrementId the order number a shopper sees
 * @returns {Promise<null | { outcome: "skipped", statusCode: number, message: string }>} the
 *   answer that ends the delivery for a reset-closed order, or null for any other
 */
export async function resetClosedAnswer(incrementId) {
  const mark = incrementId ? await closedByReset(incrementId) : null;
  return mark
    ? {
        message: `order ${incrementId} was closed by the demo reset on ${mark.day}; it is not sent to any ERP.`,
        outcome: "skipped",
        statusCode: OK,
      }
    : null;
}

/**
 * The same answer for an event that names the order only by its entity id (an invoice, a
 * shipment, a return): the order is read for its number. A read that fails answers null, so the
 * event goes on as before (it needs the same order next, and fails there the way it always has).
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
    return await resetClosedAnswer(order?.increment_id);
  } catch {
    return null;
  }
}
