import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordingErpEvent } from "#lib/erp-event-history";
import { paymentReferenceOf } from "#lib/payment-reference";
import { stringParameters } from "#lib/utils";
import { handlePartMessage } from "#router/part-outcomes";
import {
  addComment,
  cancelOrder,
  getOrder,
  holdOrder,
  unholdOrder,
} from "#src/order/commerce-order-api-client";

const REFUSED =
  "Commerce did not cancel this order because part of it is already invoiced or shipped.";

/*
 * A card captured at checkout (Authorize and Capture) invoiced the order in Commerce, so
 * Commerce keeps it, and the money is the web shop's to give back (AB-26s; owner 2026-10-02,
 * flow 1: the web shop owns the gateway, nothing in the ERP or here moves card money).
 */
const CARD_KEPT =
  "The card payment was captured at checkout, so Commerce keeps the order: the card payment is refunded in the web shop, with a credit memo from its invoice.";

/**
 * be-observer.sales_order_cancel: cancel the Commerce order the ERP cancelled, and say
 * why in the order's history — the ERP's own reason, so the Commerce Admin reads as a
 * downstream of the ERP's decision rather than a bare cancellation.
 *
 * Commerce will not cancel an order once any of it is invoiced or shipped: it keeps the order
 * and the rest has to be closed with a credit memo (Experience League, Invoices). The call
 * does not fail when that happens, so the order is read back: if it is not cancelled, it is
 * put On Hold for staff and its history says so, instead of claiming a cancel that did not
 * happen. It answers success either way; retrying would not change Commerce's mind.
 *
 * With several ERPs a cancel is one ERP's part: the router records it and holds the order for
 * staff (router/combined-status.js); the Commerce order is never cancelled automatically.
 */
async function handle(params) {
  const logger = AioLogger("order-external-cancelled", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const orderId = Number(params.data?.orderId ?? params.data?.id);
  if (!Number.isFinite(orderId)) {
    return badRequest("the event carries no orderId");
  }
  try {
    const part = await handlePartMessage(
      params,
      "cancel",
      params.data,
      orderId,
    );
    if (part) {
      return part.matched ? ok(part.message) : badRequest(part.reason);
    }
    // Commerce cannot cancel an order On Hold: a rejected credit hold comes off hold first.
    const order = await getOrder(params, orderId);
    if (order?.state === "holded") {
      await unholdOrder(params, orderId);
    }
    await cancelOrder(params, orderId);
    const after = await getOrder(params, orderId);
    const erp = params.data.erpNumber
      ? ` (ERP sales order ${params.data.erpNumber})`
      : "";
    const reason =
      typeof params.data.reason === "string" && params.data.reason
        ? `: ${params.data.reason}`
        : "";
    const cancelled = after?.state === "canceled";
    const outcome = cancelled
      ? ""
      : `. ${await holdForStaff(params, orderId, logger, paymentReferenceOf(order?.payment) !== null)}`;
    await addComment(params, orderId, {
      statusHistory: {
        comment: `Canceled in the ERP${erp}${reason}${outcome}`,
        is_customer_notified: 0,
        is_visible_on_front: 0,
      },
    });
    return ok(
      cancelled
        ? "Order canceled successfully"
        : "Commerce kept the order (invoiced or shipped); it is held for a credit memo",
    );
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/**
 * Put a refused cancel On Hold; answers why Commerce kept the order, what staff do, and
 * whether the hold worked.
 */
async function holdForStaff(params, orderId, logger, paidByCard) {
  let held = true;
  try {
    await holdOrder(params, orderId);
  } catch (error) {
    logger.warn(`order ${orderId} could not be held: ${error.message}`);
    held = false;
  }
  if (paidByCard) {
    return `${CARD_KEPT} ${held ? "It is On Hold so nothing ships; take it off hold to make the credit memo." : "It could not be put On Hold."}`;
  }
  return `${REFUSED} ${held ? "It is On Hold" : "It could not be put On Hold"}: close the rest with a credit memo.`;
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("cancel", handle);

export { main };
