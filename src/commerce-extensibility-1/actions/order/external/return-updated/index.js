import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordingErpEvent } from "#lib/erp-event-history";
import { stringParameters } from "#lib/utils";
import { returnReceivedFromErp } from "#router/return-received";

/**
 * be-observer.rma_status_update: the goods of one ERP's return order are back (contract
 * version 13, status received). The Commerce return gets a comment naming the ERP and its
 * return order, and that ERP's items are set received for the quantities it received
 * (router/return-received.js). Setting return statuses through the API was read back live
 * on 2026-10-02 (live test R-T2).
 *
 * Written under the order's lock; while another write holds it the event answers 503 and is
 * delivered again.
 */
async function handle(params) {
  const logger = AioLogger("order-external-return-updated", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  try {
    const result = await returnReceivedFromErp(params, params.data);
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
const main = recordingErpEvent("return", handle);

export { main };
