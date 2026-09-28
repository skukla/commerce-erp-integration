/*
 * The adapter for the demo ERP (skukla/demo-erp). Sending a part is the order send
 * (lib/order-sync.js): the request shaping, the idempotent create, the history and the
 * hold-or-drop rules all live there.
 *
 * A part of an order shared between several ERPs (`part.shared`) is sent to this ERP's own
 * address under its own name, with only its lines, and without the single-ERP bookkeeping on
 * the Commerce order (its one ERP number field): the router owns that view.
 */
import { sendOrderToErp } from "#lib/order-sync";

/** @type {import("../contract.js").SendPart} */
export function sendPart(params, part, deps) {
  if (!part.shared) {
    // One ERP: the whole order, sent as it came.
    return sendOrderToErp(params, part.order, deps);
  }
  const ownParams = {
    ...params,
    ERP_BASE_URL: part.erp.connection?.baseUrl ?? params.ERP_BASE_URL,
    ERP_DISPLAY_NAME: part.erp.name,
  };
  return sendOrderToErp(ownParams, { ...part.order, items: part.lines }, deps, {
    shared: true,
  });
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
