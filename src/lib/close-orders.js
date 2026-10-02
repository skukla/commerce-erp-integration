/*
 * Close off every order the ERPs hold, before a reset wipes them (AB-16n, owner 2026-09-28).
 * Commerce cannot delete an order, so an order a reset leaves behind would stay open in Admin,
 * pointing at ERP documents that no longer exist. Instead:
 * - an order Commerce can still cancel, with nothing invoiced and nothing shipped, is cancelled
 *   and noted "Cancelled by the demo reset on <day>.";
 * - any other order stays as history, noted that its ERP documents were removed;
 * - the integration forgets the order: its parts record, its ERP number, its hold.
 *
 * The cancellations must not reach an ERP. Every order is marked closed in State BEFORE the
 * first Commerce write (lib/order-parts.js markClosedByReset): the new-order path would otherwise
 * read a cancelled order with no ERP number and no parts record as never sent, and send it
 * (order-commerce/created checks the mark). The change path needs no mark: by the time the cancel
 * is saved its ERP number is cleared and its parts record deleted, so it finds no ERP to tell.
 *
 * Run twice, nothing new happens: an order whose history already carries a reset's note is
 * counted as already closed and gets no second note (Commerce's own history is the record).
 */

/** Words both of the reset's notes carry; an order whose history holds them was closed before. */
const RESET_NOTE = "by the demo reset on";

export const cancelledNote = (day) => `Canceled by the demo reset on ${day}.`;
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

const qty = (value) => Number(value ?? 0);

/**
 * Whether the reset cancels this order: the owner's rule, nothing invoiced and nothing shipped,
 * inside Commerce's own (a state it can cancel from, something left to invoice: canCancel answers
 * false when every line is invoiced, Order.php). Commerce's answer to the cancel is the last word.
 * @param {object} order the order as `GET orders/{id}` answers it
 */
export function cancellableByReset(order) {
  if (UNCANCELLABLE_STATES.has(order.state)) {
    return false;
  }
  const items = Array.isArray(order.items)
    ? order.items
    : Object.values(order.items ?? {});
  if (items.some((i) => qty(i.qty_invoiced) > 0 || qty(i.qty_shipped) > 0)) {
    return false;
  }
  return items.some((i) => qty(i.qty_ordered) - qty(i.qty_canceled) > 0);
}

/** Whether an order's history already carries a reset's note (it was closed before). */
export const hasResetNote = (order) =>
  (order.status_histories ?? []).some((h) =>
    String(h?.comment ?? "").includes(RESET_NOTE),
  );

/**
 * The orders to close: every one an ERP listed, and every one with a parts record, each read once.
 * @param {object} params action params
 * @param {string[]} listedIds the Commerce order ids the ERPs' order lists name
 * @param {object} deps `{ commerce, orderParts }`
 * @returns {Promise<{ orders: object[], failed: object[], stale: number }>} `stale`: parts
 *   records dropped for orders Commerce does not have
 */
async function readTargets(params, listedIds, { commerce, orderParts }) {
  const ids = new Set(listedIds.map(String));
  const failed = [];
  // The reads run together: this runs inside detach, a web action with a 60-second answer
  // window, and one read at a time over a day of test orders outran it (Justrite, 2026-10-02).
  const numbers = await orderParts.listOrderPartsIds();
  const hits = await Promise.all(
    numbers.map((incrementId) =>
      commerce.findOrderByIncrementId(params, incrementId),
    ),
  );
  let stale = 0;
  for (const [index, found] of hits.entries()) {
    if (found) {
      ids.add(String(found.entityId));
      // biome-ignore lint/performance/noAwaitInLoops: a rare drop of a stale record
    } else if (await orderParts.deleteOrderParts(numbers[index])) {
      // A record for an order Commerce does not have: nothing to close, only the record to drop.
      stale += 1;
    }
  }
  const read = await Promise.all(
    [...ids].map(async (id) => {
      try {
        return await commerce.orders.get(params, id);
      } catch (error) {
        failed.push({
          error: `order ${id}: not read from Commerce: ${error.message}`,
          orderId: id,
        });
        return null;
      }
    }),
  );
  return { failed, orders: read.filter(Boolean), stale };
}

/**
 * Read every order to close and mark each closed, before anything is written to Commerce.
 * @param {object} params action params
 * @param {string[]} listedIds the Commerce order ids the ERPs' order lists name
 * @param {object} deps `{ commerce, orderParts, today() }`
 * @returns {Promise<{ day: string, orders: object[], failed: object[], stale: number }>}
 */
export async function prepareClose(params, listedIds, deps) {
  const day = deps.today();
  const targets = await readTargets(params, listedIds, deps);
  for (const order of targets.orders) {
    // biome-ignore lint/performance/noAwaitInLoops: one mark at a time, few orders
    await deps.orderParts.markClosedByReset(order.increment_id, day);
  }
  return { day, ...targets };
}

/** Close one order; `step` names what was being done when a call fails. */
async function closeOne(params, order, deps, tally) {
  const { commerce, orderParts } = deps;
  const id = order.entity_id;
  const step = { name: "the parts record delete" };
  try {
    if (await orderParts.deleteOrderParts(order.increment_id)) {
      tally.closed.partsRemoved += 1;
    }
    if (order.ext_order_id && !tally.cleared.has(String(id))) {
      step.name = "the ERP number clear";
      await commerce.clearExtOrderId(params, id);
      tally.orders.cleared += 1;
    }
    if (hasResetNote(order)) {
      tally.closed.alreadyClosed += 1;
      return;
    }
    if (order.state === "holded") {
      step.name = "the release of its hold";
      if (await commerce.unholdIfHeld(params, id)) {
        tally.holds.released += 1;
      }
    }
    step.name = "the cancel";
    const cancelled =
      cancellableByReset(order) &&
      (await commerce.orders.cancel(params, id)) === true;
    step.name = "the note";
    const note = cancelled ? cancelledNote(tally.day) : removedNote(tally.day);
    await commerce.orders.comment(params, id, note);
    tally.closed[cancelled ? "cancelled" : "commented"] += 1;
  } catch (error) {
    tally.closed.failed.push({
      error: `order ${order.increment_id}: ${step.name} failed: ${error.message}`,
      orderId: String(order.increment_id),
    });
  }
}

/**
 * Close every prepared order. Detach has already cleared the ERP numbers and released the holds
 * of the orders the ERPs listed (`cleared`); what it did here is added to its own counts.
 * @param {object} params action params
 * @param {{ day: string, orders: object[], failed: object[], stale: number }} prepared
 *   prepareClose's answer
 * @param {object} deps `{ commerce, orderParts }`
 * @param {{ cleared: Set<string>, orders: object, holds: object }} done detach's counts
 * @returns {Promise<{ cancelled: number, commented: number, alreadyClosed: number,
 *   partsRemoved: number, failed: object[] }>}
 */
export async function closeOrders(params, prepared, deps, done) {
  const closed = {
    alreadyClosed: 0,
    cancelled: 0,
    commented: 0,
    failed: [...prepared.failed],
    partsRemoved: prepared.stale,
  };
  const tally = { ...done, closed, day: prepared.day };
  for (const order of prepared.orders) {
    // biome-ignore lint/performance/noAwaitInLoops: one order at a time, in order
    await closeOne(params, order, deps, tally);
  }
  return closed;
}
