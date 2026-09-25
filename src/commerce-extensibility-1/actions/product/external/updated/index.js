import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { nameOf, priceOf } from "#lib/commerce-before";
import { currentPriceEvent, currentProduct } from "#lib/erp-current";
import { recordingErpEvent } from "#lib/erp-event-history";
import { recordProductWrite } from "#lib/ledger";
import { stringParameters } from "#lib/utils";

import { postProcess } from "./post.js";
import { preProcess } from "./pre.js";
import { sendData } from "./sender.js";
import { transformData } from "./transformer.js";
import { validateData } from "./validator.js";

/**
 * This action is on charge of sending updated product information in external back-office application to Adobe commerce
 *
 * @returns response object with status code, request data received and response of the invoked action
 * @param {object} params - includes the env params, type and the data of the event
 */
async function handle(params) {
  const logger = AioLogger("product-external-updated", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  try {
    logger.debug(`Validate data: ${JSON.stringify(params.data)}`);
    const validation = validateData(params);
    if (!validation.success) {
      logger.error(`Validation failed with error: ${validation.message}`);
      return badRequest(validation.message);
    }
    // The event says which SKU changed; the ERP says what it is now (lib/erp-current.js).
    const { sku } = params.data;
    const product = await currentProduct(params, sku);
    if (!product) {
      return badRequest(`The ERP has no product ${sku}; nothing to apply`);
    }
    const current = { ...params, data: currentPriceEvent(sku, product) };
    logger.debug(`Transform data: ${stringParameters(current)}`);
    const transformed = transformData(current);
    logger.debug(`Preprocess data: ${stringParameters(params)}`);
    const preProcessed = preProcess(current, transformed);
    // What Commerce held before this write, so removing the integration can put it
    // back: Commerce is the permanent system and the ERP is transient (lib/ledger.js).
    const beforePrice = await priceOf(params, transformed.product.sku);
    const beforeName = await nameOf(params, transformed.product.sku);
    logger.debug(`Start sending data: ${JSON.stringify(transformed)}`);
    const result = await sendData(current, transformed, preProcessed, logger);
    if (!result.success) {
      logger.error(`Send data failed: ${result.message}`);
      return buildErrorResponse(result.statusCode, {
        body: { message: result.message },
      });
    }
    if (beforePrice !== undefined && transformed.product.price !== undefined) {
      await recordProductWrite({
        after: Number(transformed.product.price),
        before: beforePrice,
        field: "price",
        sku: transformed.product.sku,
      });
    }
    // The same write sets the name, so the name needs putting back too.
    if (beforeName !== undefined && transformed.product.name !== undefined) {
      await recordProductWrite({
        after: transformed.product.name,
        before: beforeName,
        field: "name",
        sku: transformed.product.sku,
      });
    }
    logger.debug(`Postprocess data: ${stringParameters(params)}`);
    postProcess(current, transformed, preProcessed, result);
    logger.debug("Process finished successfully");
    return ok("Product updated successfully");
  } catch (error) {
    logger.error(`Error processing the request: ${error}`);
    return internalServerError(error.message);
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("price", handle);

export { main };
