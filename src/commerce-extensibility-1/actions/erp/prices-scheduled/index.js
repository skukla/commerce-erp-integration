import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { describePublish, publishPrices } from "#lib/publish-prices";
import { recordScheduledRun } from "#lib/scheduled-runs";

/**
 * The scheduled price publish, started every hour by the erp-prices-hourly-timer alarm
 * (ext.config.yaml). The ERP raises no event when a price line's start or end date arrives,
 * so this run is what makes the date take effect, within the hour: every ERP's prices in
 * force are published again, exactly as erp/prices does. A publish is a replace that writes
 * only changes, so the runs in between change nothing. Not a web action: a timer carries no
 * Adobe sign-in, and erp/prices requires one.
 */
async function main(params) {
  const logger = AioLogger("erp-prices-scheduled", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const result = await publishPrices(params);
    logger.info(describePublish(result));
    // The Admin page's Activity shows when this last ran and what it changed.
    await recordScheduledRun("prices", result);
    return ok({ body: result });
  } catch (error) {
    logger.error(`scheduled prices failed: ${error.message}`);
    await recordScheduledRun("prices", { error: error.message });
    return internalServerError(error.message);
  }
}

export { main };
