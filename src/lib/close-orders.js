/*
 * Close off every order the ERPs hold, before a reset wipes them (AB-16n, owner 2026-09-28), by
 * the ONE reset rule shared with Demo Builder's Clear (lib/reset-rule.js, owner 2026-10-30,
 * changed 2026-11-11). Commerce cannot delete an order, so each one gets, in this order:
 *
 * 1. its reset note FIRST, decided from the plan (lib/reset-rule.js leadingNoteOf): "Canceled by
 *    the demo reset on <day>.", "Refunded and closed by the demo reset on <day>.", or, for one in
 *    payment review, "The ERP documents for this order were removed by the demo reset on <day>.";
 *    none when a stopped run already wrote a reset note;
 * 2. the integration forgets it: its parts record, and its ERP number unless detach cleared it;
 * 3. its open returns closed (PUT returns/{id}, status "closed", read back); one Commerce keeps
 *    open stops the order there, reported, for the next run;
 * 4. off hold, if held;
 * 5. canceled; or invoiced for whatever is not yet invoiced (POST order/{orderId}/invoice,
 *    `{ capture: false, notify: false }`, every remaining line), read back, and everything
 *    invoiced refunded offline (POST order/{orderId}/refund), so Commerce closes it;
 * 6. ONE correcting note only when Commerce's answer differs: a cancel not answered `true` gets the
 *    left-open note and counts `commented`; a refund after which the order does not read Closed
 *    gets "Refunded the invoiced items by the demo reset on <day>." (still counted `refunded`).
 *
 * None of it may reach an ERP. Every order is marked closed in State BEFORE the first Commerce
 * write (lib/order-parts.js markClosedByReset), and its note is the first write to it; every
 * handler of an event those writes raise finds the mark or the note and sends nothing
 * (lib/reset-closed.js): the order save (order-commerce/created and changed), the invoice save
 * (order-commerce/invoiced, which the invoice step raises) and the return save
 * (order-commerce/return-saved). A credit memo save raises no event this app subscribes to
 * (app.commerce.config.ts).
 *
 * Run twice, nothing new happens: an order already canceled or closed, or carrying the left-open
 * note, is counted as already closed and gets no write; one a stopped run noted but did not close
 * is finished without a second note; a closed return is no longer open.
 */
import {
  leadingNoteOf,
  openReturns,
  refundedOpenNote,
  refundOf,
  removedNote,
  resetPlanOf,
} from "#lib/reset-rule";

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

/**
 * Close the order's open returns in turn. The first that fails stops the order (thrown, named in
 * `step`), as Demo Builder's copy does: the note is already written, so the next run finishes it.
 */
async function closeReturnsOf(params, order, deps, tally, step) {
  const client = deps.orderClient;
  const open = openReturns(
    await client.listOrderReturns(params, order.entity_id),
  );
  for (const rma of open) {
    step.name = `return ${rma.increment_id ?? rma.entity_id}: the close`;
    // biome-ignore lint/performance/noAwaitInLoops: one return at a time, few returns
    await closeReturn(params, rma, client);
    tally.closed.returnsClosed += 1;
  }
}

/**
 * Refund everything invoiced, read from Commerce after any invoice, then read the order back;
 * answers whether Commerce closed it. Throws when Commerce has nothing invoiced left to refund.
 */
async function refundAll(params, id, deps, step) {
  step.name = "the read before the refund";
  const now = await deps.commerce.orders.get(params, id);
  step.name = "the refund";
  const body = now ? refundOf(now) : null;
  if (!body) {
    throw new Error("Commerce has nothing invoiced left to refund on it");
  }
  await deps.orderClient.refundOrder(params, id, body);
  step.name = "the read after the refund";
  const after = await deps.commerce.orders.get(params, id);
  return after?.state === "closed";
}

/**
 * Release, then cancel or invoice-and-refund, after the note and the returns; ONE correcting note
 * when Commerce's answer differs from the leading note. Answers the order's outcome.
 */
async function settle(params, order, plan, deps, tally, step) {
  const id = order.entity_id;
  const note = (text) => {
    step.name = "the correcting note";
    return deps.commerce.orders.comment(params, id, text);
  };
  if (plan.unhold) {
    step.name = "the release of its hold";
    if (await deps.commerce.unholdIfHeld(params, id)) {
      tally.holds.released += 1;
    }
  }
  if (plan.action === "cancel") {
    step.name = "the cancel";
    if ((await deps.commerce.orders.cancel(params, id)) === true) {
      return "cancelled";
    }
    await note(removedNote(tally.day));
    return "commented";
  }
  if (plan.invoice) {
    step.name = "the invoice";
    await deps.orderClient.invoiceRemainder(params, id);
  }
  if (await refundAll(params, id, deps, step)) {
    return "refunded";
  }
  await note(refundedOpenNote(tally.day));
  return "refundedOpen";
}

/** Record what was done to one order, for a caller that asked for the list (`done.touched`). */
function touch(tally, order, outcome) {
  tally.touched?.push({ orderId: String(order.increment_id), outcome });
}

/** Count and record one order's outcome; every refund counts as refunded, closed or not. */
function count(tally, order, outcome) {
  tally.closed[outcome === "refundedOpen" ? "refunded" : outcome] += 1;
  touch(tally, order, outcome);
}

/** Close one order; `step` names what was being done when a call fails. */
async function closeOne(params, order, deps, tally) {
  const plan = resetPlanOf(order);
  const step = { name: "the parts record delete" };
  try {
    if (plan === "done") {
      await forget(params, order, deps, tally, step);
      count(tally, order, "alreadyClosed");
      return;
    }
    // A left-open order is finished only by its own note, so a rerun writes that one even after another.
    if (!plan.noted || plan.action === "note") {
      step.name = "the note";
      await deps.commerce.orders.comment(
        params,
        order.entity_id,
        leadingNoteOf(plan.action, tally.day),
      );
    }
    step.name = "the parts record delete";
    await forget(params, order, deps, tally, step);
    step.name = "the read of its returns";
    await closeReturnsOf(params, order, deps, tally, step);
    const outcome =
      plan.action === "note"
        ? "commented"
        : await settle(params, order, plan, deps, tally, step);
    count(tally, order, outcome);
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
 *   invoiceRemainder, refundOrder }, orderParts }`
 * @param {{ cleared: Set<string>, orders: object, holds: object, touched?: object[] }} done
 *   detach's counts; with `touched`, each order is added to it as `{ orderId, outcome }`
 *   (`cancelled`, `refunded`, `refundedOpen`, `commented`, `alreadyClosed` or `failed`)
 * @returns {Promise<{ cancelled: number, refunded: number, commented: number,
 *   alreadyClosed: number, returnsClosed: number, partsRemoved: number, failed: object[] }>}
 *   `commented`: orders left open with a note (payment review, nothing to refund, or a cancel
 *   Commerce refused); `refunded`: every order refunded, including one Commerce kept open
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
