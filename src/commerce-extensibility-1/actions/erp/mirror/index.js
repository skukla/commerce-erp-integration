import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { listCompanies, listProducts, listStock } from "#lib/commerce";
import { erp } from "#lib/erp";
import { mirror } from "#lib/mirror";

/** POST mirror: read Commerce products, stock and companies into the ERP (the import half of reset). */
async function main(params) {
  const logger = AioLogger("erp-mirror", { level: params.LOG_LEVEL || "info" });
  try {
    const result = await mirror(
      params,
      { listCompanies, listProducts, listStock },
      erp,
      params.projectName,
    );
    logger.info(
      `mirrored ${result.counts.products} products and ${result.counts.companies} companies`,
    );
    return ok({ body: result });
  } catch (error) {
    logger.error(`mirror failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
