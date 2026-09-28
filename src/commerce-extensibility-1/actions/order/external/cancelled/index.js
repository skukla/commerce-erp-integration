import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordingErpEvent } from "#lib/erp-event-history";
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
      : `. ${REFUSED} ${await holdForStaff(params, orderId, logger)}`;
    await addComment(params, orderId, {
      statusHistory: {
        comment: `Cancelled in the ERP${erp}${reason}${outcome}`,
        is_customer_notified: 0,
        is_visible_on_front: 0,
      },
    });
    return ok(
      cancelled
        ? "Order cancelled successfully"
        : "Commerce kept the order (invoiced or shipped); it is held for a credit memo",
    );
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** Put a refused cancel On Hold; answers the sentence that says whether it worked. */
async function holdForStaff(params, orderId, logger) {
  try {
    await holdOrder(params, orderId);
    return "It is On Hold: close the rest with a credit memo.";
  } catch (error) {
    logger.warn(`order ${orderId} could not be held: ${error.message}`);
    return "It could not be put On Hold: close the rest with a credit memo.";
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("cancel", handle);

export { main };
