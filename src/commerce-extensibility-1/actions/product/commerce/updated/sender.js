import { HTTP_INTERNAL_SERVER_ERROR } from "@adobe/aio-commerce-sdk/core/responses";

import { warehousesOfSku } from "#lib/commerce";
import { withEventId } from "#lib/commerce-events";
import { erp } from "#lib/erp";
import { ownerParams } from "#lib/owner-params";

/**
 * Send the product to the ERP's import route.
 *
 * @returns {Promise<{ success: true } | { success: false, statusCode: number, message: string }>}
 */
async function sendData(params, data) {
  try {
    // Rule M3: a product another ERP owns is not sent, and that is a success, not a refusal.
    // It goes to the ERP that owns it, at that ERP's address (router/erp-params.js).
    const sku = data.products?.[0]?.sku;
    const to = sku ? await ownerParams(params, sku) : { params };
    if (to.skip) {
      return { message: to.skip, skipped: true, success: true };
    }
    // A save on the product page is how a person changes stock at any source, and Commerce
    // raises no event for a source's quantity: the product's stock goes with it.
    const stock = sku
      ? [{ sku, warehouses: await warehousesOfSku(params, sku) }]
      : [];
    // The transformer names the event; only the action's params carry its id.
    const res = await erp.importRecords(to.params, {
      ...data,
      origin: withEventId(data.origin, params),
      ...(stock.length ? { stock } : {}),
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
