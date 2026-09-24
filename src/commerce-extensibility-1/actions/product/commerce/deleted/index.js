import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";
import { erp } from "#lib/erp";
import { stringParameters } from "#lib/utils";

/** Commerce answers 404 for a SKU the ERP never had or already removed: nothing to do twice. */
const GONE = 404;

/**
 * observer.catalog_product_delete_commit_after: a product deleted in Commerce leaves the
 * ERP too (bidirectional review, gap G1). Until this handler the record lingered in the
 * ERP until the next reset. The ERP unlinks a deleted parent's variants itself, the way
 * Commerce leaves a configurable product's children as products of their own.
 */
async function main(params) {
  const logger = AioLogger("product-commerce-deleted", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const product = params.data?.value ?? params.data ?? {};
  const sku = typeof product.sku === "string" ? product.sku.trim() : "";
  if (!sku) {
    return badRequest("the event carries no sku");
  }
  try {
    const res = await erp.deleteProduct(params, sku, {
      origin: originOf(COMMERCE_EVENTS.productDeleted, params),
    });
    if (res.ok) {
      return ok(`Product ${sku} removed from the ERP`);
    }
    if (res.status === GONE) {
      return ok(`Product ${sku} was not in the ERP`);
    }
    return internalServerError(
      res.data?.errorMessage || `ERP answered ${res.status}`,
    );
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
