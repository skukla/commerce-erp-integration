import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordCommerceChange } from "#lib/history";
import { returnToErps } from "#router/return-pieces";

/**
 * observer.rma_save_commit_after: a return was saved in Commerce. Each ERP that sold its lines
 * is sent its piece as a return order, once (router/return-pieces.js); a later save of the
 * same return sends nothing new. Only the return's id is read from the event (its payload has
 * not been captured live): the return is read from Commerce.
 *
 * A 503 answer asks I/O Events to deliver again later (an ERP down, the order's lock taken);
 * a 400 ends the delivery (an ERP refused, or no line was sold through an ERP).
 */
async function main(params) {
  const logger = AioLogger("order-commerce-return-saved", {
    level: params.LOG_LEVEL || "info",
  });
  const value = params.data?.value ?? params.data;
  const returnId = Number(value?.entity_id ?? value?.id);
  if (!(Number.isFinite(returnId) && returnId > 0)) {
    return badRequest("the return event carries no entity_id");
  }
  try {
    const result = await returnToErps(params, returnId);
    logger.info(result.message);
    await recordCommerceChange("returned", value, result, { logger });
    if (result.outcome === "held") {
      return buildErrorResponse(result.statusCode, {
        body: { message: result.message },
      });
    }
    if (result.outcome === "dropped") {
      return badRequest(result.message);
    }
    return ok({ body: { message: result.message } });
  } catch (error) {
    logger.error(`return saved event failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
