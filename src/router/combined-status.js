/*
 * The combined order status (design v1 §3.3, revised by the owner 2026-09-28), and the only
 * writer of what it implies.
 *
 * Commerce holds one status per order; the router holds each part's outcome. A part WAITS while
 * it is held or failed (its ERP refused credit, blocks the company, or is down) or was cancelled
 * by its ERP (staff close it with a credit memo); a line that reached no ERP, or two, waits too.
 * The rule:
 * - On Hold only while EVERY part waits. Commerce will not ship or invoice an order On Hold, so
 *   holding the whole order for one ERP's part would stop the other ERPs' shipments and
 *   invoices.
 * - While SOME parts wait and others move, the order keeps its state with the custom status
 *   "Partly on hold" (code `partly_on_hold`), set by an order comment that names the waiting
 *   ERP and why. A comment can set only a status assigned to the order's CURRENT state, so the
 *   status must be assigned to Pending and Processing in Commerce (docs/demo-setup.md); if
 *   Commerce refuses it, the note is written alone and the event still succeeds.
 * - Pending until every part is sent; Processing while parts move. When the last waiting part
 *   is released, the status returns to the state's own, with a note saying so.
 * - Complete is Commerce's own: every part shipped and invoiced. Never cancelled
 *   automatically: every part cancelled holds the order and asks staff to cancel it.
 *
 * With one ERP the whole order is its one part: a held part is every part, so the order goes On
 * Hold, as before (setWholeOrderHold for the single-ERP handlers).
 */
import {
  addComment,
  getOrder,
  holdOrder,
  unholdOrder,
} from "#src/order/commerce-order-api-client";

/** Commerce's state word for an order On Hold. */
const HOLDED = "holded";

/** The custom order status for an order some of whose parts wait. */
export const PARTLY_ON_HOLD = "partly_on_hold";

/** A state's own status, to return to when no part waits any more. */
const STATE_DEFAULT = Object.freeze({
  new: "pending",
  processing: "processing",
});

/** States the router never touches: the order is finished. */
const FINISHED = Object.freeze(["canceled", "closed", "complete"]);

const WAITS = Object.freeze(["held", "failed", "cancelled"]);
const SENDING = "sending";

/** Commerce's order calls, looked up when used: a module that only imports this file never needs them. */
const commerceCalls = () => ({
  // Wrapped, so a caller whose path writes no comment never touches the binding.
  addComment: (...args) => addComment(...args),
  getOrder,
  holdOrder,
  unholdOrder,
});

/** Every waiting piece of the order, in words. */
function waitingPieces(record) {
  const pieces = Object.entries(record?.parts ?? {})
    .filter(([, part]) => WAITS.includes(part.status))
    .map(([id, part]) =>
      part.status === "cancelled"
        ? `${id} was cancelled in its ERP; close it with a credit memo`
        : `waiting on ${id} (${part.status})`,
    );
  if ((record?.unrouted ?? []).length > 0) {
    pieces.push(`${record.unrouted.join(", ")} reached no ERP`);
  }
  if ((record?.conflicts ?? []).length > 0) {
    pieces.push(
      `${record.conflicts.map((c) => c.sku).join(", ")} is claimed by two ERPs`,
    );
  }
  return pieces;
}

/**
 * @param {{ parts: object, unrouted?: string[], conflicts?: object[] }} record the order's parts
 * @returns {{ status: "on-hold"|"partly-held"|"pending"|"processing", reason: string }}
 */
export function combinedStatus(record) {
  const statuses = Object.values(record?.parts ?? {}).map((p) => p.status);
  const waiting = waitingPieces(record);
  const moving = statuses.filter((s) => !WAITS.includes(s));
  if (waiting.length > 0 && moving.length === 0) {
    const allCancelled =
      statuses.length > 0 && statuses.every((s) => s === "cancelled");
    return {
      reason: allCancelled
        ? "every part was cancelled in its ERP; cancel the order in Commerce"
        : waiting.join("; "),
      status: "on-hold",
    };
  }
  if (waiting.length > 0) {
    return { reason: waiting.join("; "), status: "partly-held" };
  }
  if (statuses.includes(SENDING)) {
    return { reason: "a part is still being sent", status: "pending" };
  }
  return { reason: "every part is with its ERP", status: "processing" };
}

/** What to do for a partly held order. */
function decidePartly(state, current) {
  if (state === HOLDED) {
    return "release-partly";
  }
  return current === PARTLY_ON_HOLD ? "none" : "partly";
}

/**
 * What to do to the Commerce order for a combined status.
 * @param {"on-hold"|"partly-held"|"pending"|"processing"} status the combined status
 * @param {string} state the order's state in Commerce
 * @param {string} [current] the order's status in Commerce
 * @returns {"hold"|"release"|"partly"|"release-partly"|"clear-partly"|"none"}
 */
export function decideOrderAction(status, state, current) {
  if (FINISHED.includes(state)) {
    return "none";
  }
  if (status === "on-hold") {
    return state === HOLDED ? "none" : "hold";
  }
  if (status === "partly-held") {
    return decidePartly(state, current);
  }
  if (state === HOLDED) {
    return "release";
  }
  return current === PARTLY_ON_HOLD ? "clear-partly" : "none";
}

/**
 * Write a status by comment, with its note. A status Commerce refuses (not assigned to the
 * order's state) leaves the note alone: logged, never a failed event.
 */
async function writeStatus(params, orderId, status, note, commerce, logger) {
  const history = {
    comment: note,
    is_customer_notified: 0,
    is_visible_on_front: 0,
  };
  try {
    await commerce.addComment(params, orderId, {
      statusHistory: { ...history, status },
    });
  } catch (error) {
    if (error.response?.status !== 400) {
      throw error;
    }
    logger?.warn?.(
      `order ${orderId}: status "${status}" refused (${error.message}); assign it to the order's state in Stores > Order Status. Writing the note alone.`,
    );
    await commerce.addComment(params, orderId, { statusHistory: history });
  }
}

/** Mark the order Partly on hold, taking it off hold first if every part had been waiting. */
async function markPartly(
  params,
  orderId,
  combined,
  release,
  commerce,
  logger,
) {
  if (release) {
    await commerce.unholdOrder(params, orderId);
  }
  await writeStatus(
    params,
    orderId,
    PARTLY_ON_HOLD,
    `Partly on hold: ${combined.reason}. The other parts go ahead.`,
    commerce,
    logger,
  );
}

/** Return the status to the state's own now that no part waits. */
async function clearPartly(params, orderId, state, commerce, logger) {
  const note = "No part is waiting any more.";
  const status = STATE_DEFAULT[state];
  if (status) {
    await writeStatus(params, orderId, status, note, commerce, logger);
    return;
  }
  await commerce.addComment(params, orderId, {
    statusHistory: {
      comment: note,
      is_customer_notified: 0,
      is_visible_on_front: 0,
    },
  });
}

/**
 * Write the combined status of a routed order: hold, release, or mark it Partly on hold.
 * @param {object} params action params
 * @param {number} orderId the Commerce order id
 * @param {object} record the order's parts
 * @param {object} [commerce] the order client (test seam)
 * @param {{ warn: Function }} [logger] where a refused status is reported
 * @returns {Promise<{ status: string, reason: string, action: string }>}
 */
export async function applyCombinedStatus(
  params,
  orderId,
  record,
  commerce = commerceCalls(),
  logger = console,
) {
  const combined = combinedStatus(record);
  const order = await commerce.getOrder(params, orderId);
  const action = decideOrderAction(
    combined.status,
    order?.state,
    order?.status,
  );
  if (action === "hold") {
    await commerce.holdOrder(params, orderId);
  }
  if (action === "release") {
    await commerce.unholdOrder(params, orderId);
  }
  if (action === "partly" || action === "release-partly") {
    await markPartly(
      params,
      orderId,
      combined,
      action === "release-partly",
      commerce,
      logger,
    );
  }
  if (action === "clear-partly") {
    await clearPartly(params, orderId, order?.state, commerce, logger);
  }
  return { ...combined, action };
}

/**
 * One ERP: the whole order is the part, so its hold follows the ERP's message. Idempotent on
 * redelivery: an order already On Hold is not held twice.
 * @param {object} params action params
 * @param {number} orderId the Commerce order id
 * @param {boolean} held whether the ERP holds it
 * @param {object} [commerce] the order client (test seam)
 */
export async function setWholeOrderHold(
  params,
  orderId,
  held,
  commerce = commerceCalls(),
) {
  const order = await commerce.getOrder(params, orderId);
  const isHeld = order?.state === HOLDED;
  if (held && !isHeld) {
    await commerce.holdOrder(params, orderId);
  }
  if (!held && isHeld) {
    await commerce.unholdOrder(params, orderId);
  }
}
