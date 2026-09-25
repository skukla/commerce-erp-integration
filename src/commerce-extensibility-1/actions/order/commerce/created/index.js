import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordOrderOutcome } from "#lib/history";
import { orderSyncDeps } from "#lib/order-deps";
import { sendOrderToErp } from "#lib/order-sync";

/**
 * observer.sales_order_save_commit_after: a new Commerce order goes to the ERP and the
 * ERP's number comes back onto it (lib/order-sync.js). A 503 answer asks I/O Events to
 * deliver again later; a 400 ends the delivery.
 */
async function main(params) {
  const logger = AioLogger("order-commerce-created", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const order = params.data?.value ?? params.data;
    const result = await sendOrderToErp(params, order, orderSyncDeps(logger));
    logger.info(result.message);
    // For the Commerce Admin screen's history and its Retry (lib/history.js).
    await recordOrderOutcome(order, result, { logger });
    // Held (the ERP is away) and failed (the ERP took it, the write-back did not land) both
    // ask I/O Events to deliver again; a retry is safe (lib/order-sync.js).
    if (result.outcome === "held" || result.outcome === "failed") {
      return buildErrorResponse(result.statusCode, {
        body: { message: result.message },
      });
    }
    if (result.outcome === "dropped") {
      return badRequest(result.message);
    }
    return ok({ body: { message: result.message } });
  } catch (error) {
    // Commerce or storage was unreachable: let I/O Events deliver again.
    logger.error(`order event failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
