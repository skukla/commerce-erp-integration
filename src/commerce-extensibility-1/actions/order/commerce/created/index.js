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

const SOURCE_FIELD = /source|nominat/i;

/**
 * What the order event carries on its lines, in field names only, plus any field about an
 * inventory source (a source code is not personal): logged to learn whether the per-line
 * nominated source reaches the event (sandbox check, 2026-09-28).
 */
function orderLineShape(order) {
  const raw = order?.items ?? [];
  const items = Array.isArray(raw) ? raw : Object.values(raw);
  const first = items[0] ?? {};
  const sourceFields = Object.fromEntries(
    Object.entries(first).filter(([key]) => SOURCE_FIELD.test(key)),
  );
  return {
    fields: Object.keys(first).sort(),
    lines: items.length,
    orderFields: Object.keys(order ?? {}).filter((key) =>
      SOURCE_FIELD.test(key),
    ),
    sourceFields,
  };
}

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
    logger.info(`order event lines: ${JSON.stringify(orderLineShape(order))}`);
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
