import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { orderChangeFromCommerce } from "#lib/commerce-changes";
import { erp } from "#lib/erp";
import { recordCommerceChange } from "#lib/history";
import { settingsFor } from "#lib/settings";
import { orderChangeToParts } from "#router/part-changes";

/**
 * observer.sales_order_save_commit_after, the saves that are NOT a new order: a cancellation or a
 * hold made in Commerce reaches the ERP, and an order taken off hold in Commerce releases the hold
 * Commerce made (bidirectional review, G4). On an order several ERPs share, each ERP holding an
 * open part is told about its own sales order. The new order itself is order-commerce/created's.
 * A 503 answer asks I/O Events to deliver again later; a 400 ends the delivery.
 */
async function main(params) {
  const logger = AioLogger("order-commerce-changed", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const order = params.data?.value ?? params.data;
    // A split order: every ERP holding an open part is told (router/part-changes.js).
    const result =
      (await orderChangeToParts(params, order)) ??
      (await orderChangeFromCommerce(params, order, { erp, settingsFor }));
    logger.info(result.message);
    await recordCommerceChange(
      "changed",
      params.data?.value ?? params.data,
      result,
      { logger },
    );
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
    logger.error(`changed event failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
