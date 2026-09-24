import { HTTP_INTERNAL_SERVER_ERROR } from "@adobe/aio-commerce-sdk/core/responses";

import { productAttributes, sourceCodesOf } from "#lib/commerce";
import { originOf } from "#lib/commerce-events";
import { erp } from "#lib/erp";
import { settingsFor } from "#lib/settings";
import { ownsSku } from "#lib/structure";

/**
 * Send the product to the ERP's import route.
 *
 * @returns {Promise<{ success: true } | { success: false, statusCode: number, message: string }>}
 */
async function sendData(params, data) {
  try {
    // Rule M3: a product another ERP owns is not sent, and that is a success, not a refusal.
    const sku = data.products?.[0]?.sku;
    const settings = await settingsFor(null);
    if (
      sku &&
      !(await ownsSku(params, sku, settings, {
        productAttributes,
        sourceCodesOf,
      }))
    ) {
      return {
        message: `${sku} is not this ERP's product`,
        skipped: true,
        success: true,
      };
    }
    // The transformer names the event; only the action's params carry its id.
    const res = await erp.importRecords(params, {
      ...data,
      origin: originOf(data.origin?.event, params),
    });
    if (!res.ok) {
      return {
        message: res.data?.errorMessage || `ERP answered ${res.status}`,
        statusCode: res.status,
        success: false,
      };
    }
    return { success: true };
  } catch (error) {
    return {
      message: error.message,
      statusCode: HTTP_INTERNAL_SERVER_ERROR,
      success: false,
    };
  }
}

export { sendData };
