import { HTTP_INTERNAL_SERVER_ERROR } from "@adobe/aio-commerce-sdk/core/responses";

import { skuForProductId, warehousesOfSku } from "#lib/commerce";
import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";
import { erp } from "#lib/erp";
import { erpTold } from "#lib/erps";
import { ownerParams } from "#lib/owner-params";

/**
 * Look the SKU up in Commerce (the stock event names only the product id) and import the
 * quantity into the ERP as the product's stock. The SKU, each source's quantity and the ERP
 * told come back for the Activity record (index.js).
 *
 * @returns {Promise<{ success: true, sku: string, warehouses: object[], erp?: object } |
 *   { success: true, skipped: true, message: string } |
 *   { success: false, statusCode: number, message: string, sku?: string }>}
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
    const warehouses = await warehousesOfSku(params, sku);
    const res = await erp.importRecords(to.params, {
      origin: originOf(COMMERCE_EVENTS.stockItemSaved, params, sku),
      stock: [{ sku, warehouses }],
    });
    if (!res.ok) {
      return {
        message: res.data?.errorMessage || `ERP answered ${res.status}`,
        sku,
        statusCode: res.status,
        success: false,
      };
    }
    const told = await erpTold(params, to.ownerId);
    return { sku, success: true, warehouses, ...(told ? { erp: told } : {}) };
  } catch (error) {
    return {
      message: error.message,
      statusCode: HTTP_INTERNAL_SERVER_ERROR,
      success: false,
    };
  }
}

export { sendData };
