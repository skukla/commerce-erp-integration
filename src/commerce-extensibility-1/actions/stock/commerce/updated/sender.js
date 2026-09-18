import { HTTP_INTERNAL_SERVER_ERROR } from "@adobe/aio-commerce-sdk/core/responses";

import { skuForProductId } from "#lib/commerce";
import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";
import { erp } from "#lib/erp";

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
    // The ERP puts `stock` on the product's default warehouse: the stock item tracks
    // Commerce's default source.
    const res = await erp.importRecords(params, {
      origin: originOf(COMMERCE_EVENTS.stockItemSaved, params),
      products: [{ sku, stock: transformed.stock }],
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
