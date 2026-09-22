import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { readHistory, recordOrderOutcome } from "#lib/history";
import { orderSyncDeps } from "#lib/order-deps";
import { retryOrderToErp } from "#lib/order-sync";
import { readPayload } from "#lib/webhook";

/** Order numbers are letters, digits and dashes; anything else never reaches Commerce. */
const ORDER_NUMBER = /^[A-Za-z0-9-]{1,50}$/u;

/**
 * The Commerce Admin screen's history (lib/history.js).
 * GET ?failedOnly=true&ref=<order>: the records, newest first.
 * POST { incrementId }: send that order to the ERP again, record it as an admin's retry,
 *   and answer how it ended with the order's record. An order that still did not get
 *   through is an answer, not an error: the record says why.
 */
async function main(params) {
  const logger = AioLogger("erp-history", {
    level: params.LOG_LEVEL || "info",
  });
  const method = String(params.__ow_method || "get").toLowerCase();
  try {
    if (method === "post") {
      const { incrementId } = readPayload(params);
      if (typeof incrementId !== "string" || !ORDER_NUMBER.test(incrementId)) {
        return badRequest("Name the order to retry by its order number.");
      }
      const result = await retryOrderToErp(
        params,
        incrementId,
        orderSyncDeps(logger),
      );
      logger.info(`retry: ${result.message}`);
      await recordOrderOutcome({ increment_id: incrementId }, result, {
        logger,
        retriedBy: "admin",
      });
      const [entry] = await readHistory({ ref: incrementId });
      return ok({
        body: { entry, message: result.message, outcome: result.outcome },
      });
    }
    const entries = await readHistory({
      failedOnly: params.failedOnly === "true",
      ...(params.ref ? { ref: String(params.ref) } : {}),
    });
    return ok({ body: { entries } });
  } catch (error) {
    logger.error(`history failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
