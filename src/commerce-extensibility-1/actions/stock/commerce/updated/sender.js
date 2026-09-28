import { HTTP_INTERNAL_SERVER_ERROR } from "@adobe/aio-commerce-sdk/core/responses";

import { skuForProductId, warehousesOfSku } from "#lib/commerce";
import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";
import { erp } from "#lib/erp";
import { ownerParams } from "#lib/owner-params";

/**
 * Look the SKU up in Commerce (the stock event names only the product id) and import the
 * quantity into the ERP as the product's stock.
 *
 * @returns {Promise<{ success: true } | { success: false, statusCode: number, message: string }>}
 */
async function sendData(params, transformed) {
  try {
    const sku = await skuForProductId(params, transformed.productId);
    if (!sku) {
      return {
        message: `no product with id ${transformed.productId}`,
        statusCode: 404,
        success: false,
      };
    }
    // Rule M3: a product another ERP owns is not sent, and that is a success, not a refusal.
    // It goes to the ERP that owns it, at that ERP's address (router/erp-params.js).
    const to = await ownerParams(params, sku);
    if (to.skip) {
      return { message: to.skip, skipped: true, success: true };
    }
    // The stock item is Commerce's default source only, so its quantity is not the
    // product's stock once other sources exist: the event is the cue to read them all.
    const res = await erp.importRecords(to.params, {
      origin: originOf(COMMERCE_EVENTS.stockItemSaved, params),
      stock: [{ sku, warehouses: await warehousesOfSku(params, sku) }],
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
