import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { erp } from "#lib/erp";
import { recordingErpEvent } from "#lib/erp-event-history";
import { stringParameters } from "#lib/utils";
import {
  addComment,
  getOrder,
  holdOrder,
  unholdOrder,
} from "#src/order/commerce-order-api-client";

/** Commerce's state word for an order On Hold. */
const HOLDED = "holded";

/**
 * be-observer.sales_order_hold: the ERP created a sales order and held it for credit
 * (`held: true`), or released it (`held: false`). The Commerce order goes On Hold and
 * comes off it, with the ERP's reason in the order's history — SAP's blocked sales
 * document, seen from the shop's side. A reject travels as a cancel, not here.
 *
 * Before writing, the handler asks ITS OWN ERP whether it holds the order (rule M2 of
 * the multi-ERP review): an event about an order this ERP does not know, or one whose
 * credit status disagrees with the event, is refused rather than applied.
 */
/**
 * The event's fields the handler needs, or the refusal for what is missing.
 * @returns {{ event: object|null, refusal: string|null }}
 */
function readEvent(data) {
  const orderId = Number(data.orderId ?? data.id);
  if (!Number.isFinite(orderId)) {
    return { event: null, refusal: "the event carries no orderId" };
  }
  if (typeof data.held !== "boolean") {
    return { event: null, refusal: "the event carries no held flag" };
  }
  if (typeof data.erpNumber !== "string" || !data.erpNumber) {
    return { event: null, refusal: "the event carries no erpNumber" };
  }
  return {
    event: {
      erpNumber: data.erpNumber,
      held: data.held,
      orderId,
      reason: data.reason,
    },
    refusal: null,
  };
}

/** Rule M2: the refusal when this ERP does not hold (or know) the order the way the event says. */
async function ownErpDisagrees(params, event) {
  const own = await erp.order(params, event.erpNumber);
  if (!own.ok) {
    return `sales order ${event.erpNumber} is not this ERP's (the ERP answered ${own.status})`;
  }
  const holds = own.data?.creditStatus === "held";
  if (holds !== event.held) {
    return `the ERP ${holds ? "holds" : "does not hold"} sales order ${event.erpNumber}; the event says ${event.held ? "held" : "released"}`;
  }
  return null;
}

/** Put the order On Hold or take it off, then say so in its history. Idempotent on redelivery. */
async function apply(params, event) {
  const order = await getOrder(params, event.orderId);
  const onHold = order?.state === HOLDED;
  const erpNote = ` (ERP sales order ${event.erpNumber})`;
  if (event.held && !onHold) {
    await holdOrder(params, event.orderId);
  }
  if (!event.held && onHold) {
    await unholdOrder(params, event.orderId);
  }
  const reason =
    typeof event.reason === "string" && event.reason ? `: ${event.reason}` : "";
  await addComment(params, event.orderId, {
    statusHistory: {
      comment: event.held
        ? `On credit hold in the ERP${erpNote}${reason}`
        : `Credit hold released in the ERP${erpNote}`,
      is_customer_notified: 0,
      is_visible_on_front: 0,
    },
  });
  return event.held ? "Order put on hold" : "Order taken off hold";
}

async function handle(params) {
  const logger = AioLogger("order-external-hold", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const { event, refusal } = readEvent(params.data ?? {});
  if (typeof refusal === "string") {
    return badRequest(refusal);
  }
  try {
    const disagreement = await ownErpDisagrees(params, event);
    if (disagreement) {
      return badRequest(disagreement);
    }
    return ok(await apply(params, event));
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("hold", handle);

export { main };
