import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { orderSyncDeps } from "#lib/order-deps";
import { readPayload } from "#lib/webhook";
import { resendPart } from "#router/resend-part";

/** Order numbers are letters, digits and dashes; anything else never reaches Commerce. */
const ORDER_NUMBER = /^[A-Za-z0-9-]{1,50}$/u;
/** ERP ids as the ERP list allows them (lib/erps.js). */
const ERP_ID = /^[a-z][a-z0-9-]{0,62}$/u;

/**
 * Re-send one part of an order (router/resend-part.js): the parts page's Re-send button.
 * POST { incrementId, erpId }: send that ERP's part again, only that part, and write the
 * order's combined status again. A part already with its ERP answers as done and is not
 * sent twice; a part that cannot be sent now is answered with why.
 */
async function main(params) {
  const logger = AioLogger("erp-resend-part", {
    level: params.LOG_LEVEL || "info",
  });
  const method = String(params.__ow_method || "get").toLowerCase();
  if (method !== "post") {
    return badRequest(`resend-part does not answer ${method.toUpperCase()}`);
  }
  const { erpId, incrementId } = readPayload(params);
  if (typeof incrementId !== "string" || !ORDER_NUMBER.test(incrementId)) {
    return badRequest("Name the order by its order number.");
  }
  if (typeof erpId !== "string" || !ERP_ID.test(erpId)) {
    return badRequest("Name the part by its ERP's id.");
  }
  try {
    const result = await resendPart(
      params,
      { erpId, incrementId },
      orderSyncDeps(logger),
    );
    logger.info(`resend ${incrementId}/${erpId}: ${result.message}`);
    if (result.statusCode >= 400) {
      return buildErrorResponse(result.statusCode, {
        body: { message: result.message, outcome: result.outcome },
      });
    }
    return ok({
      body: {
        message: result.message,
        outcome: result.outcome,
        part: result.part ?? null,
      },
    });
  } catch (error) {
    logger.error(`resend-part failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
