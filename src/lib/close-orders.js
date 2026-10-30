/*
 * Close off every order the ERPs hold, before a reset wipes them (AB-16n, owner 2026-09-28), by
 * the ONE reset rule shared with Demo Builder's store wipe (lib/reset-rule.js, owner 2026-10-30):
 * a reset resets everything. Commerce cannot delete an order, so instead:
 * - its open returns are closed (PUT returns/{id}, status "closed");
 * - an order with nothing invoiced and nothing shipped, that Commerce can still cancel, is
 *   canceled and noted "Canceled by the demo reset on <day>.";
 * - any other not already canceled or closed has what is invoiced refunded with an offline credit
 *   memo (POST order/{orderId}/refund), so Commerce closes it, and is noted "Refunded and closed
 *   by the demo reset on <day>." (read back: one Commerce keeps open, partly invoiced, is noted
 *   "Refunded the invoiced items by the demo reset on <day>.");
 * - one Commerce can neither cancel nor credit (shipped but never invoiced; in payment review)
 *   stays open, noted that its ERP documents were removed, and is counted as `commented`;
 * - the integration forgets the order: its parts record, its ERP number, its hold.
 *
 * None of it may reach an ERP. Every order is marked closed in State BEFORE the first Commerce
 * write (lib/order-parts.js markClosedByReset), and every handler of an event those writes raise
 * reads the mark first and sends nothing (lib/reset-closed.js): the order save (order-commerce/
 * created and changed: a cancel, a refund, a hold released, a note, the ERP number cleared), the
 * invoice save (order-commerce/invoiced, in case Commerce saves the invoice a refund credits) and
 * the return save (order-commerce/return-saved). A credit memo save raises no event this app
 * subscribes to (app.commerce.config.ts).
 *
 * Run twice, nothing new happens: an order whose history already carries a reset's note is
 * counted as already closed and gets no second note (Commerce's own history is the record), and a
 * closed return is no longer open.
 */
import {
  cancelledNote,
  hasResetNote,
  openReturns,
  refundedNote,
  refundedOpenNote,
  refundOf,
  removedNote,
  resetStepOf,
} from "#lib/reset-rule";

/** Each outcome's note; a refund's depends on the state Commerce then gave the order. */
const NOTES = {
  cancelled: cancelledNote,
  commented: removedNote,
  refunded: refundedNote,
  refundedOpen: refundedOpenNote,
};

/** Read each order whole, together; one Commerce cannot answer is a failure, the rest go on. */
async function readOrders(params, ids, commerce) {
  const failed = [];
  // The reads run together: this runs inside a web action with a 60-second answer window, and
  // one read at a time over a day of test orders outran it (Justrite, 2026-10-02).
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
  return { failed, orders: read.filter(Boolean) };
}

/**
 * The orders a whole reset closes: every one an ERP listed, and every one with a parts record,
 * each read once.
 * @param {object} params action params
 * @param {string[]} listedIds the Commerce order ids the ERPs' order lists name
 * @param {object} deps `{ commerce, orderParts }`
 * @returns {Promise<{ orders: object[], failed: object[], stale: number }>} `stale`: parts
 *   records dropped for orders Commerce does not have
 */
async function readTargets(params, listedIds, { commerce, orderParts }) {
  const ids = new Set(listedIds.map(String));
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
  return { ...(await readOrders(params, ids, commerce)), stale };
}

/** Mark every order closed, before anything is written to Commerce. */
async function markAll(orders, deps, day) {
  for (const order of orders) {
    // biome-ignore lint/performance/noAwaitInLoops: one mark at a time, few orders
    await deps.orderParts.markClosedByReset(order.increment_id, day);
  }
}

/**
 * Read every order a whole reset closes and mark each closed, before anything is written to
 * Commerce.
 * @param {object} params action params
 * @param {string[]} listedIds the Commerce order ids the ERPs' order lists name
 * @param {object} deps `{ commerce, orderParts, today() }`
 * @returns {Promise<{ day: string, orders: object[], failed: object[], stale: number }>}
 */
export async function prepareClose(params, listedIds, deps) {
  const day = deps.today();
  const targets = await readTargets(params, listedIds, deps);
  await markAll(targets.orders, deps, day);
  return { day, ...targets };
}

/**
 * Read exactly these orders and mark each closed, before anything is written to Commerce: a
 * store-scoped close (lib/close-store-orders.js), which closes the orders of some stores only.
 * @param {object} params action params
 * @param {string[]} orderIds the Commerce order ids to close
 * @param {object} deps `{ commerce, orderParts, today() }`
 * @returns {Promise<{ day: string, orders: object[], failed: object[], stale: number }>}
 */
export async function prepareCloseOf(params, orderIds, deps) {
  const day = deps.today();
  const targets = await readOrders(params, orderIds.map(String), deps.commerce);
  await markAll(targets.orders, deps, day);
  return { day, ...targets, stale: 0 };
}

/** Forget the order: its parts record, and its ERP number unless detach cleared it already. */
async function forget(params, order, deps, tally, step) {
  if (await deps.orderParts.deleteOrderParts(order.increment_id)) {
    tally.closed.partsRemoved += 1;
  }
  if (order.ext_order_id && !tally.cleared.has(String(order.entity_id))) {
    step.name = "the ERP number clear";
    await deps.commerce.clearExtOrderId(params, order.entity_id);
    tally.orders.cleared += 1;
  }
}

/**
 * Close one return: read it whole, write back its header with status "closed". Adobe names
 * "Closed" the status a merchant gives a return whose items are not processed for return
 * (experienceleague.adobe.com/en/docs/commerce-admin/stores-sales/order-management/returns/returns,
 * read 2026-10-30). Written as router/return-statuses.js writes a return (both measured on the
 * Justrite sandbox 2026-10-02): with its increment_id, or Commerce renumbers it; without its
 * comments and tracks, which are saved through their own routes; and with no items, which
 * Commerce keeps as they are (it refuses an approved item sent back, even unchanged). Read back:
 * a return Commerce did not close is a failure, in words.
 */
async function closeReturn(params, rma, client) {
  const {
    comments: _c,
    tracks: _t,
    ...whole
  } = await client.getReturn(params, rma.entity_id);
  await client.updateReturn(params, rma.entity_id, {
    ...whole,
    items: [],
    status: "closed",
  });
  const saved = await client.getReturn(params, rma.entity_id);
  if (saved?.status !== "closed") {
    throw new Error(`Commerce kept it ${saved?.status ?? "open"}`);
  }
}

/** Close the order's open returns, each on its own: one that fails is reported, the rest go on. */
async function closeReturnsOf(params, order, deps, tally) {
  const client = deps.orderClient;
  const open = openReturns(
    await client.listOrderReturns(params, order.entity_id),
  );
  for (const rma of open) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one return at a time, few returns
      await closeReturn(params, rma, client);
      tally.closed.returnsClosed += 1;
    } catch (error) {
      tally.closed.failed.push({
        error: `order ${order.increment_id}: return ${rma.increment_id ?? rma.entity_id}: the close failed: ${error.message}`,
        orderId: String(order.increment_id),
      });
    }
  }
}

/**
 * Cancel or refund the order as the rule says; answers which note it gets (NOTES). A refund is
 * read back: Commerce closes an order only once nothing is left to invoice or credit, so a partly
 * invoiced order stays open and its note says only the invoiced items were refunded.
 */
async function settle(params, order, next, deps, step) {
  const id = order.entity_id;
  if (next === "cancel") {
    step.name = "the cancel";
    // Commerce's answer is the last word: a refused cancel is noted as one it could not make.
    return (await deps.commerce.orders.cancel(params, id)) === true
      ? "cancelled"
      : "commented";
  }
  if (next === "refund") {
    step.name = "the refund";
    await deps.orderClient.refundOrder(params, id, refundOf(order));
    step.name = "the read after the refund";
    const after = await deps.commerce.orders.get(params, id);
    return after?.state === "closed" ? "refunded" : "refundedOpen";
  }
  return "commented";
}

/** Record what was done to one order, for a caller that asked for the list (`done.touched`). */
function touch(tally, order, outcome) {
  tally.touched?.push({ orderId: String(order.increment_id), outcome });
}

/** Close one order; `step` names what was being done when a call fails. */
async function closeOne(params, order, deps, tally) {
  const id = order.entity_id;
  const step = { name: "the parts record delete" };
  try {
    await forget(params, order, deps, tally, step);
    step.name = "the read of its returns";
    await closeReturnsOf(params, order, deps, tally);
    const next = resetStepOf(order);
    if (hasResetNote(order) || next === "untouched") {
      tally.closed.alreadyClosed += 1;
      touch(tally, order, "alreadyClosed");
      return;
    }
    if (order.state === "holded") {
      step.name = "the release of its hold";
      if (await deps.commerce.unholdIfHeld(params, id)) {
        tally.holds.released += 1;
      }
    }
    const outcome = await settle(params, order, next, deps, step);
    step.name = "the note";
    await deps.commerce.orders.comment(params, id, NOTES[outcome](tally.day));
    // Every refund counts as refunded, closed or not: the note tells the two apart.
    tally.closed[outcome === "refundedOpen" ? "refunded" : outcome] += 1;
    touch(tally, order, outcome);
  } catch (error) {
    touch(tally, order, "failed");
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
 * @param {object} deps `{ commerce, orderClient: { listOrderReturns, getReturn, updateReturn,
 *   refundOrder }, orderParts }`
 * @param {{ cleared: Set<string>, orders: object, holds: object, touched?: object[] }} done
 *   detach's counts; with `touched`, each order is added to it as `{ orderId, outcome }`
 *   (`cancelled`, `refunded`, `refundedOpen`, `commented`, `alreadyClosed` or `failed`)
 * @returns {Promise<{ cancelled: number, refunded: number, commented: number,
 *   alreadyClosed: number, returnsClosed: number, partsRemoved: number, failed: object[] }>}
 *   `commented`: orders Commerce could neither cancel nor credit, left open with a note;
 *   `refunded`: every order refunded, including one Commerce kept open (partly invoiced)
 */
export async function closeOrders(params, prepared, deps, done) {
  const closed = {
    alreadyClosed: 0,
    cancelled: 0,
    commented: 0,
    failed: [...prepared.failed],
    partsRemoved: prepared.stale,
    refunded: 0,
    returnsClosed: 0,
  };
  const tally = { ...done, closed, day: prepared.day };
  for (const order of prepared.orders) {
    // biome-ignore lint/performance/noAwaitInLoops: one order at a time, in order
    await closeOne(params, order, deps, tally);
  }
  return closed;
}
