import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import {
  listSources,
  productAttributes,
  skusForProductIds,
  sourceCodesOf,
  transferAllStock,
  transferSomeStock,
  warehousesOfSku,
} from "#lib/commerce";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { moveProblem, moveStock } from "#lib/move-stock";
import { ownsSku } from "#lib/structure";
import { readPayload } from "#lib/webhook";
import { ownerWithParams } from "#router/erp-params";

/**
 * The product grid's "Move stock between <ERP> warehouses" (lib/move-stock.js).
 * GET: the inventory sources to choose from and the ERP's name, `{ erpName, sources: [{ code, name }] }`,
 *   with several ERPs also `erpNames`, every ERP a move may go to.
 * POST { productIds, from, to, quantity? }: move the stock in Commerce, then tell the ERP (with
 * several ERPs, each product's owner; the answer's `told` says which ERP got which products and
 * `untold` the products no one ERP owns, which no ERP was told).
 */
async function main(params) {
  const logger = AioLogger("erp-move-stock", {
    level: params.LOG_LEVEL || "info",
  });
  const method = String(params.__ow_method || "get").toLowerCase();
  try {
    if (method === "get") {
      const [names, erps] = await Promise.all([
        listSources(params),
        loadErps(params),
      ]);
      const sources = [...names].map(([code, name]) => ({ code, name }));
      return ok({
        body: {
          erpName: params.ERP_DISPLAY_NAME || "the ERP",
          // Several ERPs: a move goes to each product's owner, so the page names them all.
          ...(erps.length > 1 ? { erpNames: erps.map((e) => e.name) } : {}),
          sources,
        },
      });
    }
    if (method !== "post") {
      return badRequest(`move-stock does not answer ${method.toUpperCase()}`);
    }
    const request = readPayload(params);
    const problem = moveProblem(request);
    if (problem) {
      return badRequest(problem);
    }
    const result = await moveStock(params, request, {
      importStock: erp.importRecords,
      // Several ERPs: each product's stock goes to the ERP that owns it.
      ownerOf: ownerWithParams(await loadErps(params), (p, sku, settings) =>
        ownsSku(p, sku, settings, { productAttributes, sourceCodesOf }),
      ),
      skusForProductIds,
      transferAll: transferAllStock,
      transferSome: transferSomeStock,
      warehousesOfSku,
    });
    logger.info(
      `moved ${result.moved.length} products from ${request.from} to ${request.to}`,
    );
    return ok({ body: result });
  } catch (error) {
    logger.error(`move-stock failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
