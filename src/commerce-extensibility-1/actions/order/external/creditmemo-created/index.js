import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordingErpEvent } from "#lib/erp-event-history";
import { stringParameters } from "#lib/utils";
import { creditMemoFromErp } from "#router/credit-memos";

/**
 * be-observer.sales_order_creditmemo_create: the ERP credited some lines of an order, for a
 * return or without one (contract version 13). Commerce gets one credit memo of exactly those
 * lines, offline, refunded to company credit on an order paid on account
 * (router/credit-memos.js). With several ERPs the lines must be the ERP's own part of the order.
 *
 * Credit memos and partial invoices on one order are made one at a time; while another is
 * being made the event answers 503 and is delivered again. A redelivered credit memo credits
 * nothing twice.
 */
async function handle(params) {
  const logger = AioLogger("order-external-creditmemo-created", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const orderId = Number(params.data?.orderId ?? params.data?.id);
  if (!Number.isFinite(orderId)) {
    return badRequest("the event carries no orderId");
  }
  try {
    const result = await creditMemoFromErp(params, orderId, params.data);
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
const main = recordingErpEvent("credit-memo", handle);

export { main };
