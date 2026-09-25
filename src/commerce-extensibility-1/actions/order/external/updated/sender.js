import { HTTP_INTERNAL_SERVER_ERROR } from "@adobe/aio-commerce-sdk/core/responses";

import { settingsFor } from "#lib/settings";
import { addComment, getOrder } from "#src/order/commerce-order-api-client";

const BAD_REQUEST = 400;

/**
 * A confirmation may also set the status the store's "Order status when the ERP confirms"
 * setting names. The ERP's event names the order but not its store, so the order is read
 * first.
 *
 * What Commerce allows here (Experience League, "Order status", read 2026-09-25): a status
 * belongs to a state, and a comment can set only a status of the order's CURRENT state;
 * custom statuses "not set as default can be used only in the comments section". An order
 * leaves Pending when it is invoiced or shipped ("Order workflow"), never by a comment, so
 * the earlier setting that promised Processing on confirm could not work: Commerce answered
 * 400 "The status \"processing\" is not part of the order status history" on every
 * pending order (measured on ACCS, 2026-09-25). The status to set is therefore one the SC
 * created and assigned to the Pending state, and blank means a note only.
 * @returns {Promise<string|undefined>} the status to set, if any
 */
async function statusFor(params) {
  if (params.data.status !== "confirmed") {
    return;
  }
  const order = await getOrder(params, params.data.id);
  const settings = await settingsFor(order?.store_id);
  return settings.orders_confirm_status || undefined;
}

/** Commerce refusing the status (not assigned to the order's state, or no such code). */
const refusedStatus = (error) => error.response?.statusCode === BAD_REQUEST;

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
    if (!status) {
      return {
        message: await addComment(params, params.data.id, transformed),
        success: true,
      };
    }
    try {
      const response = await addComment(params, params.data.id, {
        statusHistory: { ...transformed.statusHistory, status },
      });
      return { message: response, success: true };
    } catch (error) {
      if (!refusedStatus(error)) {
        throw error;
      }
      // A status Commerce will not take on this order (its state, or the code): the note
      // still lands, and the delivery is not retried for a day over a setting.
      await addComment(params, params.data.id, transformed);
      return {
        message: `Commerce did not take status "${status}" on this order (${error.message}); the note was added without it.`,
        success: true,
      };
    }
  } catch (error) {
    return {
      message: error.message,
      statusCode: error.response?.statusCode || HTTP_INTERNAL_SERVER_ERROR,
      success: false,
    };
  }
}

export { sendData };
