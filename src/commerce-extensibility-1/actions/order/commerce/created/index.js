import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordOrderOutcome } from "#lib/history";
import { orderSyncDeps } from "#lib/order-deps";
import { closedByReset } from "#lib/order-parts";
import { routeOrder } from "#router/route-order";

/**
 * The answer for an order a demo reset closed (lib/close-orders.js), or null for any other. The
 * reset clears the order's ERP number and parts record before it cancels the order, so every
 * save it makes would otherwise read as a new order never sent, and go to the ERPs.
 */
async function closedByResetAnswer(order) {
  const mark = order?.increment_id
    ? await closedByReset(order.increment_id)
    : null;
  return mark
    ? {
        message: `order ${order.increment_id} was closed by the demo reset on ${mark.day}; it is not sent to any ERP.`,
        outcome: "skipped",
        statusCode: 200,
      }
    : null;
}

/**
 * observer.sales_order_save_commit_after: a new Commerce order goes to the router, which
 * hands each ERP its part through that ERP's adapter (src/router/route-order.js); the ERP's
 * number comes back onto the order (lib/order-sync.js). An order a demo reset closed is never
 * sent (AB-16n). A 503 answer asks I/O Events to
 * deliver again later; a 400 ends the delivery.
 */
async function main(params) {
  const logger = AioLogger("order-commerce-created", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const order = params.data?.value ?? params.data;
    const result =
      (await closedByResetAnswer(order)) ??
      (await routeOrder(params, order, orderSyncDeps(logger)));
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
