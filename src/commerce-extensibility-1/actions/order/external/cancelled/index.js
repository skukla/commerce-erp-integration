import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordingErpEvent } from "#lib/erp-event-history";
import { stringParameters } from "#lib/utils";
import { cancelOrder } from "#src/order/commerce-order-api-client";

/** be-observer.sales_order_cancel: cancel the Commerce order the ERP cancelled. */
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
    await cancelOrder(params, orderId);
    return ok("Order cancelled successfully");
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("cancel", handle);

export { main };
