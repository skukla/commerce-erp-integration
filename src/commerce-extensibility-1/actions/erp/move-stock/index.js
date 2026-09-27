import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import {
  listSources,
  skusForProductIds,
  transferAllStock,
  transferSomeStock,
  warehousesOfSku,
} from "#lib/commerce";
import { erp } from "#lib/erp";
import { moveProblem, moveStock } from "#lib/move-stock";
import { readPayload } from "#lib/webhook";

/**
 * The product grid's "Move stock between <ERP> warehouses" (lib/move-stock.js).
 * GET: the inventory sources to choose from and the ERP's name, `{ erpName, sources: [{ code, name }] }`.
 * POST { productIds, from, to, quantity? }: move the stock in Commerce, then tell the ERP.
 */
async function main(params) {
  const logger = AioLogger("erp-move-stock", {
    level: params.LOG_LEVEL || "info",
  });
  const method = String(params.__ow_method || "get").toLowerCase();
  try {
    if (method === "get") {
      const names = await listSources(params);
      const sources = [...names].map(([code, name]) => ({ code, name }));
      return ok({
        body: { erpName: params.ERP_DISPLAY_NAME || "the ERP", sources },
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
