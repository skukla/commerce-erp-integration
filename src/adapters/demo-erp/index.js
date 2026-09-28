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
    erpId: part.erp.id,
    shared: true,
  });
}

/** The demo ERP's order messages, as the part outcome each one means. */
const OUTCOMES = Object.freeze({
  cancel: () => ["cancelled", "cancelled in the ERP"],
  hold: (data) =>
    data.held
      ? ["held", "on credit hold in the ERP"]
      : ["sent", "credit hold released in the ERP"],
  invoice: () => ["invoiced", "invoiced in the ERP"],
  "order-status": (data) =>
    data.status === "cancelled"
      ? ["cancelled", "cancelled in the ERP"]
      : [
          String(data.status || "sent"),
          `${data.status || "updated"} in the ERP`,
        ],
  shipment: () => ["shipped", "shipped by the ERP"],
});

/**
 * @type {import("../contract.js").ReadOutcome}
 * One of the demo ERP's order messages (the starter kit's actions under
 * actions/order/external/ receive them) as the outcome of this ERP's part. Every message
 * carries the ERP's sales order number (demo-erp lib/orders.js orderEventPayload).
 */
export function readOutcome(event) {
  const read = OUTCOMES[event?.type];
  if (!read) {
    return null;
  }
  const data = event.data ?? {};
  const [outcome, words] = read(data);
  const reason =
    typeof data.reason === "string" && data.reason ? `: ${data.reason}` : "";
  return {
    erpNumber: data.erpNumber,
    message: `ERP sales order ${data.erpNumber} ${words}${reason}.`,
    outcome,
    statusCode: 200,
  };
}
