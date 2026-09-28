import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { describePublish, publishPrices } from "#lib/publish-prices";
import { readPayload } from "#lib/webhook";

/**
 * POST erp/prices `{ erpId? }`: publish every customer's ERP contract prices in force into
 * the companies' shared catalogs as tier prices (lib/publish-prices.js), for one ERP or
 * every ERP. Demo Builder calls it after a fill; it may be run again at any time, and
 * erp/prices-scheduled runs the same publish every hour so price dates take effect. Answers
 * `{ erps, written, removed, unchanged, skipped: [{ erpId, partnerId, reason }], failed }`.
 */
async function main(params) {
  const logger = AioLogger("erp-prices", { level: params.LOG_LEVEL || "info" });
  if (String(params.__ow_method || "").toLowerCase() !== "post") {
    return badRequest("prices answers POST only");
  }
  try {
    const result = await publishPrices(params, readPayload(params).erpId);
    if (result.problem) {
      return badRequest(result.problem);
    }
    logger.info(describePublish(result));
    return ok({ body: result });
  } catch (error) {
    logger.error(`prices failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
