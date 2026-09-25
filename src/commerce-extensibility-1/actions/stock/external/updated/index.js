import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { quantityOf } from "#lib/commerce-before";
import { currentProducts, currentStockLines } from "#lib/erp-current";
import { recordingErpEvent } from "#lib/erp-event-history";
import { recordProductWrite } from "#lib/ledger";
import { stringParameters } from "#lib/utils";

import { postProcess } from "./post.js";
import { preProcess } from "./pre.js";
import { sendData } from "./sender.js";
import { transformData } from "./transformer.js";
import { validateData } from "./validator.js";

/**
 * This action is on charge of sending updated stock information in external back-office application to Adobe commerce
 *
 * @returns response object with status code, request data received and response of the invoked action
 * @param {object} params - includes the env params, type and the data of the event
 */
async function handle(params) {
  const logger = AioLogger("stock-external-updated", {
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
    // The event says which SKUs and warehouses changed; the ERP says the quantities now
    // (lib/erp-current.js). A line the ERP no longer has is dropped.
    const lines = currentStockLines(
      params.data,
      await currentProducts(params, params.data),
    );
    if (lines.length === 0) {
      return badRequest(
        "The ERP holds none of these products or warehouses; nothing to apply",
      );
    }
    const current = { ...params, data: lines };
    logger.debug(`Transform data: ${stringParameters(current)}`);
    const transformed = transformData(current);
    logger.debug(`Preprocess data: ${stringParameters(params)}`);
    const preProcessed = preProcess(current, transformed);
    // One read per source item, before the write: two sources of a SKU are two
    // different values to put back when the integration is removed (lib/ledger.js).
    const before = await Promise.all(
      transformed.sourceItems.map((item) =>
        quantityOf(params, item.sku, item.source_code),
      ),
    );
    logger.debug(`Start sending data: ${JSON.stringify(transformed)}`);
    const result = await sendData(current, transformed, preProcessed);
    if (!result.success) {
      logger.error(`Send data failed: ${result.message}`);
      return buildErrorResponse(result.statusCode, {
        body: { message: result.message },
      });
    }
    // Sequential on purpose: the ledger is one document, and parallel writes to it
    // would race each other's read-modify-write.
    for (const [index, item] of transformed.sourceItems.entries()) {
      if (before[index] === undefined) {
        continue;
      }
      // biome-ignore lint/performance/noAwaitInLoops: one ledger document, in order
      await recordProductWrite({
        after: Number(item.quantity),
        before: before[index],
        extra: { source: item.source_code },
        field: "stock",
        sku: item.sku,
      });
    }
    logger.debug(`Postprocess data: ${stringParameters(params)}`);
    postProcess(current, transformed, preProcessed, result);
    logger.debug("Process finished successfully");
    return ok("Stock updated successfully");
  } catch (error) {
    logger.error(`Error processing the request: ${error}`);
    return internalServerError(error.message);
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("stock", handle);

export { main };
