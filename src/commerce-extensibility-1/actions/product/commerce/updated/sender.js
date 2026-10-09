import { HTTP_INTERNAL_SERVER_ERROR } from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { warehousesOfSku } from "#lib/commerce";
import { withEventId } from "#lib/commerce-events";
import {
  discontinueElsewhere,
  restoreAtOwner,
} from "#lib/discontinue-elsewhere";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { ownerParams } from "#lib/owner-params";

/**
 * With several ERPs, the owner sells the product again if it had discontinued it, and every
 * other ERP still carrying it discontinues it (lib/discontinue-elsewhere.js).
 *
 * @returns {Promise<{ restoredIn?: string[], discontinuedIn?: string[] }>} the ERPs changed
 */
async function reconcileSalesStatus(params, sku, ownerId) {
  const erps = await loadErps(params);
  const logger = AioLogger("product-commerce-updated", {
    level: params.LOG_LEVEL || "info",
  });
  const restored = await restoreAtOwner(params, sku, ownerId, erps, logger);
  const discontinued = await discontinueElsewhere(
    params,
    sku,
    ownerId,
    erps,
    logger,
  );
  return {
    ...(restored.length > 0 ? { restoredIn: restored } : {}),
    ...(discontinued.length > 0 ? { discontinuedIn: discontinued } : {}),
  };
}

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
    // The owner has it: if it had discontinued the product while another ERP owned it, it
    // sells it again; an ERP that used to own it (its erp_owner or websites changed)
    // discontinues it (AB-70). Best-effort: the delivery stands whatever the ERPs answer.
    if (sku && to.ownerId) {
      return {
        success: true,
        ...(await reconcileSalesStatus(params, sku, to.ownerId)),
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
