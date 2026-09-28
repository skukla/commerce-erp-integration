/*
 * The adapter for the demo ERP (skukla/demo-erp). Sending a part is today's order send
 * (lib/order-sync.js): the request shaping, the idempotent create, the ERP number written
 * back, the history and the hold-or-drop rules all live there unchanged.
 */
import { sendOrderToErp } from "#lib/order-sync";

/**
 * @type {import("../contract.js").SendPart}
 * While there is one ERP, a part is the whole order, so the order is sent as it came.
 */
export function sendPart(params, part, deps) {
  return sendOrderToErp(params, part.order, deps);
}

/**
 * @type {import("../contract.js").ReadOutcome}
 * Not used yet. The demo ERP's messages (order updated, hold, cancel, shipment, invoice) are
 * handled by the starter kit's actions under actions/<entity>/external/, and moving them here
 * would change behaviour. Phase B slice B2 routes them through this function.
 */
export function readOutcome() {
  return null;
}
