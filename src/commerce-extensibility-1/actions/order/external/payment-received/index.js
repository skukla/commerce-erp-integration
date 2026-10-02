import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordingErpEvent } from "#lib/erp-event-history";
import { stringParameters } from "#lib/utils";
import { paymentFromErp } from "#router/payments";

/**
 * be-observer.sales_order_payment_create: the ERP posted a payment against an invoice of an
 * order (contract version 14, AB-26s). An order paid on account gives its company the paid
 * amount back on its credit, ledgered so a reset takes it back; an order paid any other way
 * changes no credit. Either way the order gets a staff-only comment (router/payments.js). With
 * several ERPs the payment must come from an ERP that holds a part of the order.
 *
 * Payments, credit memos and partial invoices on one order are made one at a time; while
 * another is being made the event answers 503 and is delivered again. A redelivered payment
 * reimburses nothing twice.
 */
async function handle(params) {
  const logger = AioLogger("order-external-payment-received", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const orderId = Number(params.data?.orderId ?? params.data?.id);
  if (!Number.isFinite(orderId)) {
    return badRequest("the event carries no orderId");
  }
  try {
    const result = await paymentFromErp(params, orderId, params.data);
    if ("busy" in result) {
      return buildErrorResponse(503, { body: { message: result.reason } });
    }
    if (!result.matched) {
      return badRequest(result.reason);
    }
    logger.info(result.message);
    return ok(result.message);
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("payment", handle);

export { main };
