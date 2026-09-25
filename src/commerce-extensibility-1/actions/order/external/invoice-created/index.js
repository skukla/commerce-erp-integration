import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordingErpEvent } from "#lib/erp-event-history";
import { stringParameters } from "#lib/utils";
import { addComment, invoiceOrder } from "#src/order/commerce-order-api-client";

/** be-observer.sales_order_invoice_create: invoice the Commerce order the ERP invoiced. */
async function handle(params) {
  const logger = AioLogger("order-external-invoice-created", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const orderId = Number(params.data?.orderId ?? params.data?.id);
  if (!Number.isFinite(orderId)) {
    return badRequest("the event carries no orderId");
  }
  try {
    await invoiceOrder(params, orderId);
    const erp = params.data.erpNumber
      ? ` (ERP sales order ${params.data.erpNumber})`
      : "";
    await addComment(params, orderId, {
      statusHistory: {
        comment: `Invoiced in the ERP${erp}`,
        is_customer_notified: 0,
        is_visible_on_front: 0,
      },
    });
    return ok("Order invoiced successfully");
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("invoice", handle);

export { main };
