import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { describePublish, publishPrices } from "#lib/publish-prices";

/**
 * The daily price publish, started by the erp-prices-daily-timer alarm (ext.config.yaml,
 * shortly after midnight UTC). The ERP raises no event when a price line's start or end
 * date arrives, so this run is what makes the date take effect: every ERP's prices in force
 * are published again, exactly as erp/prices does. A publish is a replace, so running it
 * twice changes nothing the second time. Not a web action: a timer carries no Adobe sign-in,
 * and erp/prices requires one.
 */
async function main(params) {
  const logger = AioLogger("erp-prices-daily", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const result = await publishPrices(params);
    logger.info(describePublish(result));
    return ok({ body: result });
  } catch (error) {
    logger.error(`daily prices failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
