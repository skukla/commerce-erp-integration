import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { paramsForErp } from "#adapters/contract";
import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { ownsSku } from "#lib/structure";
import { stringParameters } from "#lib/utils";
import { OWNER_ATTRIBUTE, ownersOf } from "#router/ownership";

/** Commerce answers 404 for a SKU the ERP never had or already removed: nothing to do twice. */
const GONE = 404;

/**
 * The ERPs to tell, with several ERPs (slice B7): the owner by the router's ownership rule,
 * read from the event, since the product is already gone from Commerce (its attributes and its
 * sources with it). An event that does not carry the owner attribute cannot name the owner,
 * so every ERP is told: an ERP that never had the SKU answers 404, which is nothing to do.
 */
async function erpsToTell(params, product, erps) {
  if (!(OWNER_ATTRIBUTE in product)) {
    return erps;
  }
  const readers = {
    productAttributes: async () => ({
      [OWNER_ATTRIBUTE]: product[OWNER_ATTRIBUTE],
    }),
    sourceCodesOf: async () => [],
  };
  const owners = await ownersOf(params, product.sku, erps, (p, s, settings) =>
    ownsSku(p, s, settings, readers),
  );
  return erps.filter((entry) => owners.includes(entry.id));
}

/** Tell one ERP (at its own address when there are several) to remove the SKU. */
function deleteAt(params, sku, entry, several) {
  return erp.deleteProduct(
    several ? paramsForErp(params, entry) : params,
    sku,
    {
      origin: originOf(COMMERCE_EVENTS.productDeleted, params),
    },
  );
}

/** One answer for the event from each told ERP's answer. */
function answer(sku, results) {
  const refused = results.filter((res) => !res.ok && res.status !== GONE);
  if (refused.length > 0) {
    return internalServerError(
      refused
        .map((res) => res.data?.errorMessage || `ERP answered ${res.status}`)
        .join("; "),
    );
  }
  if (results.every((res) => res.status === GONE)) {
    return ok(`Product ${sku} was not in the ERP`);
  }
  return ok(`Product ${sku} removed from the ERP`);
}

/**
 * observer.catalog_product_delete_commit_after: a product deleted in Commerce leaves the
 * ERP too (bidirectional review, gap G1). Until this handler the record lingered in the
 * ERP until the next reset. The ERP unlinks a deleted parent's variants itself, the way
 * Commerce leaves a configurable product's children as products of their own. With several
 * ERPs only the ERP that owns the product is told; with one ERP it is told, as before.
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
    const several = erps.length > 1;
    const told = several
      ? await erpsToTell(params, { ...product, sku }, erps)
      : erps;
    if (told.length === 0) {
      return ok(`Product ${sku} belongs to no ERP; nothing to remove`);
    }
    const results = [];
    for (const entry of told) {
      // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, few ERPs
      results.push(await deleteAt(params, sku, entry, several));
    }
    return answer(sku, results);
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
