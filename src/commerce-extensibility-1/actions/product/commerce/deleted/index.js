import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { loadErps } from "#lib/erps";
import { recordProductDeleted } from "#lib/history";
import { ownsSku } from "#lib/structure";
import { stringParameters } from "#lib/utils";
import { OWNER_ATTRIBUTE, ownersOf } from "#router/ownership";

/**
 * The ERPs that owned the product, with several ERPs: by the router's ownership rule, read
 * from the event, since the product is already gone from Commerce (its attributes and its
 * sources with it). Null when the event does not carry the owner attribute: it cannot say.
 */
async function ownersNamed(params, product, erps) {
  if (!(OWNER_ATTRIBUTE in product)) {
    return null;
  }
  const readers = {
    productAttributes: async () => ({
      [OWNER_ATTRIBUTE]: product[OWNER_ATTRIBUTE],
    }),
    sourceCodesOf: async () => [],
    websiteCodesOf: async () => [],
  };
  const owners = await ownersOf(params, product.sku, erps, (p, s, settings) =>
    ownsSku(p, s, settings, readers),
  );
  return erps.filter((entry) => owners.includes(entry.id));
}

/** What the history says, and the ERPs it names (several ERPs only). */
function recordOf(sku, erps, owners) {
  const deleted = `Product ${sku} was deleted in Commerce`;
  if (erps.length < 2) {
    return { message: `${deleted}. The ERP keeps it until its next reset` };
  }
  if (owners === null) {
    return {
      message: `${deleted}. An ERP that holds it keeps it until its next reset`,
    };
  }
  if (owners.length === 0) {
    return { message: deleted };
  }
  return {
    erpIds: owners.map((entry) => entry.id),
    message: `${deleted}. ${owners.map((entry) => entry.name).join(" and ")} ${owners.length === 1 ? "keeps" : "keep"} it until its next reset`,
  };
}

/**
 * observer.catalog_product_delete_commit_after: a product deleted in Commerce is recorded in
 * this integration's history and no ERP is called (AB-26y step 5). An ERP's product is not
 * deleted because a web shop dropped it; the next reset refills the ERP from Commerce, which
 * drops it there. Products pair by SKU, so the key map holds no row to unlink
 * (lib/key-map.js). With several ERPs the record names the ERP that owned the product.
 */
async function main(params) {
  const logger = AioLogger("product-commerce-deleted", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const product = params.data?.value ?? params.data ?? {};
  const sku = typeof product.sku === "string" ? product.sku.trim() : "";
  if (!sku) {
    return badRequest("the event carries no sku");
  }
  try {
    const erps = await loadErps(params);
    const owners =
      erps.length > 1
        ? await ownersNamed(params, { ...product, sku }, erps)
        : null;
    const record = recordOf(sku, erps, owners);
    await recordProductDeleted(sku, record, logger);
    return ok(record.message);
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
