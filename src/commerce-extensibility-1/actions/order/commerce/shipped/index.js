import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { shipmentFromCommerce } from "#lib/commerce-changes";
import { erp } from "#lib/erp";
import { recordCommerceChange } from "#lib/history";
import { getOrder } from "#src/order/commerce-order-api-client";

/**
 * observer.sales_order_shipment_save_after: a shipment made in Commerce is recorded on the ERP order,
 * with an origin marker so the ERP does not ship it again (bidirectional review, item 1).
 * A 503 answer asks I/O Events to deliver again later; a 400 ends the delivery.
 */
async function main(params) {
  const logger = AioLogger("order-commerce-shipped", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const result = await shipmentFromCommerce(
      params,
      params.data?.value ?? params.data,
      {
        erp,
        getOrder,
      },
    );
    logger.info(result.message);
    await recordCommerceChange(
      "shipped",
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
    logger.error(`shipped event failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
