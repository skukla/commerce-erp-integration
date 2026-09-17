import { HTTP_INTERNAL_SERVER_ERROR } from "@adobe/aio-commerce-sdk/core/responses";

import { settingsFor } from "#lib/settings";
import { addComment, getOrder } from "#src/order/commerce-order-api-client";

const PROCESSING = "processing";

/**
 * With "Mark orders Processing when the ERP confirms them" on for the order's store, a
 * confirmation also moves the order to Processing. The ERP's event names the order but not
 * its store, so the order is read first.
 * @returns {Promise<string|undefined>} the status to set, if any
 */
async function statusFor(params) {
  if (params.data.status !== "confirmed") {
    return;
  }
  const order = await getOrder(params, params.data.id);
  const settings = await settingsFor(order?.store_id);
  return settings.orders_status_on_confirm ? PROCESSING : undefined;
}

/**
 * Send the ERP's status to the Commerce order as a status-history line.
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
async function sendData(params, transformed, _preProcessed) {
  try {
    const status = await statusFor(params);
    const body = status
      ? { statusHistory: { ...transformed.statusHistory, status } }
      : transformed;
    const response = await addComment(params, params.data.id, body);
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
