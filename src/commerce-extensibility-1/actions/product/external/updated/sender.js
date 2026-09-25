import { HTTP_INTERNAL_SERVER_ERROR } from "@adobe/aio-commerce-sdk/core/responses";

import { updateProduct } from "#src/product/commerce-product-api-client";

/**
 * This function send the product updated data to the Adobe commerce REST API
 *
 * @returns {Promise<
 *   | { success: true, message: unknown }
 *   | { success: false, statusCode: number, message: string }
 * >} Result consumed by the action's `main`. On success, `message` carries the
 *   Adobe Commerce API response; on failure, `statusCode` (from the API error, or
 *   HTTP_INTERNAL_SERVER_ERROR) and `message` are forwarded to the error response.
 * @param {object} params - include the env params
 * @param {object} transformed - transformed received data
 * @param {object} preProcessed - preprocessed result data
 */
async function sendData(params, transformed, _preProcessed, logger) {
  try {
    // Timed, because on 2026-09-25 three runs hit the action's 60 s limit with nothing
    // logged after "Start processing": the client's own timeout is 30 s, so the time went
    // before the PUT (the association read, the IMS token) or the PUT hung past it.
    const started = Date.now();
    const response = await updateProduct(params, transformed, (stage) =>
      logger?.info(`${stage} after ${Date.now() - started} ms`),
    );
    logger?.info(
      `PUT products/${transformed.product?.sku} answered after ${Date.now() - started} ms`,
    );
    return {
      message: response,
      success: true,
    };
  } catch (error) {
    return {
      message: error.message,
      statusCode: error.response?.statusCode || HTTP_INTERNAL_SERVER_ERROR,
      success: false,
    };
  }
}

export { sendData };
