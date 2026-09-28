/*
 * The combined order status (design v1 §3.3), and the only writer of the hold it implies.
 *
 * Commerce holds one status per order; the router holds each part's outcome. The rule:
 * - On Hold while any part is held or failed (its ERP refused credit or is down), while a
 *   part was cancelled by its ERP (staff close it with a credit memo), or while a line
 *   reached no ERP or two (a setup error). The reason goes to the order's history.
 * - Pending until every part is sent.
 * - Processing while parts are moving. Commerce moves the order itself when a part is
 *   invoiced or shipped; a comment cannot (it sets only a status of the current state).
 * - Complete is Commerce's own: every part shipped and invoiced.
 * - Never cancelled automatically: even every part cancelled only holds the order and asks
 *   staff to cancel it.
 *
 * So what the router writes is the hold: on, off, or nothing. With one ERP the whole order
 * is the part, and its hold follows the ERP's message directly (setWholeOrderHold).
 */
import {
  getOrder,
  holdOrder,
  unholdOrder,
} from "#src/order/commerce-order-api-client";

/** Commerce's state word for an order On Hold. */
const HOLDED = "holded";

/** States the router never touches: the order is finished. */
const FINISHED = Object.freeze(["canceled", "closed", "complete"]);

const BLOCKING = Object.freeze(["held", "failed"]);
const WAITING = Object.freeze(["sending"]);

const COMMERCE = Object.freeze({ getOrder, holdOrder, unholdOrder });

function onHold(reason) {
  return { reason, status: "on-hold" };
}

/**
 * @param {{ parts: object, unrouted?: string[], conflicts?: object[] }} record the order's parts
 * @returns {{ status: "on-hold"|"pending"|"processing", reason: string }}
 */
export function combinedStatus(record) {
  const entries = Object.entries(record?.parts ?? {});
  const statuses = entries.map(([, part]) => part.status);
  const blocked = entries.filter(([, part]) => BLOCKING.includes(part.status));
  if (blocked.length > 0) {
    return onHold(
      `waiting on ${blocked.map(([id, p]) => `${id} (${p.status})`).join(", ")}`,
    );
  }
  if (statuses.length > 0 && statuses.every((s) => s === "cancelled")) {
    return onHold(
      "every part was cancelled in its ERP; cancel the order in Commerce",
    );
  }
  if (statuses.includes("cancelled")) {
    return onHold(
      "a part was cancelled in its ERP; close it with a credit memo",
    );
  }
  if ((record?.unrouted ?? []).length > 0) {
    return onHold(`${record.unrouted.join(", ")} reached no ERP`);
  }
  if ((record?.conflicts ?? []).length > 0) {
    return onHold(
      `${record.conflicts.map((c) => c.sku).join(", ")} is claimed by two ERPs`,
    );
  }
  if (statuses.some((s) => WAITING.includes(s))) {
    return { reason: "a part is still being sent", status: "pending" };
  }
  return { reason: "every part is with its ERP", status: "processing" };
}

/**
 * What to do to the Commerce order for a combined status.
 * @param {"on-hold"|"pending"|"processing"} status the combined status
 * @param {string} state the order's state in Commerce
 * @returns {"hold"|"release"|"none"}
 */
export function decideOrderAction(status, state) {
  if (FINISHED.includes(state)) {
    return "none";
  }
  if (status === "on-hold") {
    return state === HOLDED ? "none" : "hold";
  }
  return state === HOLDED ? "release" : "none";
}

/**
 * Write the combined status of a routed order: put it On Hold or take it off.
 * @param {object} params action params
 * @param {number} orderId the Commerce order id
 * @param {object} record the order's parts
 * @param {object} [commerce] the order client (test seam)
 * @returns {Promise<{ status: string, reason: string, action: string }>}
 */
export async function applyCombinedStatus(
  params,
  orderId,
  record,
  commerce = COMMERCE,
) {
  const combined = combinedStatus(record);
  const order = await commerce.getOrder(params, orderId);
  const action = decideOrderAction(combined.status, order?.state);
  if (action === "hold") {
    await commerce.holdOrder(params, orderId);
  }
  if (action === "release") {
    await commerce.unholdOrder(params, orderId);
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
  commerce = COMMERCE,
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
