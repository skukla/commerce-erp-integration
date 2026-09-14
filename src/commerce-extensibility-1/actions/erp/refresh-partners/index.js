import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import * as commerce from "#lib/commerce";
import { erp } from "#lib/erp";
import { mirrorPartners } from "#lib/mirror";

/**
 * Refresh the business partners from Commerce (companies, credit, status). Runs every minute
 * from the alarm trigger and on demand: Commerce is the master the SC prepares in, and
 * Commerce raises no event we could subscribe to for companies.
 */
async function main(params) {
  const logger = AioLogger("erp-refresh-partners", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const result = await mirrorPartners(params, commerce, erp);
    logger.info(`refreshed ${result.companies} companies into the ERP`);
    return ok({ body: result });
  } catch (error) {
    logger.error(`refresh-partners failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
