import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordingErpEvent } from "#lib/erp-event-history";
import { stringParameters } from "#lib/utils";
import { invoicePart } from "#router/part-fulfilment";
import { handlePartMessage } from "#router/part-outcomes";
import { addComment, invoiceOrder } from "#src/order/commerce-order-api-client";

/**
 * be-observer.sales_order_invoice_create: invoice the Commerce order the ERP invoiced.
 *
 * With several ERPs the invoice is one ERP's part: Commerce gets a PARTIAL invoice of that
 * part's lines (router/part-fulfilment.js), never the whole order, which would bill the other
 * ERPs' lines; then the router records the part. Partial invoices on one order are created
 * one at a time; while another is being created the event answers 503 and is delivered again.
 */
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
    const partial = await invoicePart(params, orderId, params.data);
    if (partial?.busy) {
      return buildErrorResponse(503, { body: { message: partial.reason } });
    }
    if (partial && !partial.matched) {
      return badRequest(partial.reason);
    }
    const part = await handlePartMessage(
      params,
      "invoice",
      params.data,
      orderId,
    );
    if (part) {
      return part.matched ? ok(part.message) : badRequest(part.reason);
    }
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
