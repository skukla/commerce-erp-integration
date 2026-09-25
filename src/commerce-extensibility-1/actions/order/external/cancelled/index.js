import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordingErpEvent } from "#lib/erp-event-history";
import { stringParameters } from "#lib/utils";
import {
  addComment,
  cancelOrder,
  getOrder,
  unholdOrder,
} from "#src/order/commerce-order-api-client";

/**
 * be-observer.sales_order_cancel: cancel the Commerce order the ERP cancelled, and say
 * why in the order's history — the ERP's own reason, so the Commerce Admin reads as a
 * downstream of the ERP's decision rather than a bare cancellation.
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
    // Commerce cannot cancel an order On Hold: a rejected credit hold comes off hold first.
    const order = await getOrder(params, orderId);
    if (order?.state === "holded") {
      await unholdOrder(params, orderId);
    }
    await cancelOrder(params, orderId);
    const erp = params.data.erpNumber
      ? ` (ERP sales order ${params.data.erpNumber})`
      : "";
    const reason =
      typeof params.data.reason === "string" && params.data.reason
        ? `: ${params.data.reason}`
        : "";
    await addComment(params, orderId, {
      statusHistory: {
        comment: `Cancelled in the ERP${erp}${reason}`,
        is_customer_notified: 0,
        is_visible_on_front: 0,
      },
    });
    return ok("Order cancelled successfully");
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("cancel", handle);

export { main };
