import AioLogger from "@adobe/aio-lib-core-logging";

import * as commerce from "#lib/commerce";
import { erp } from "#lib/erp";
import { mirrorPartners } from "#lib/mirror";

/**
 * What the every-minute timer runs. Not a web action: a timer carries no Adobe
 * sign-in, and `refresh-partners` (the web action the Commerce Admin page calls)
 * requires one, so every timer run of it failed in the sign-in check before its
 * code started — silently, as "server error" (measured 2026-09-16).
 */
async function main(params) {
  const logger = AioLogger("erp-refresh-partners-job", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const result = await mirrorPartners(params, commerce, erp);
    logger.info(`refreshed ${result.companies} companies into the ERP`);
    return { ok: true, ...result };
  } catch (error) {
    logger.error(`partner refresh failed: ${error.message}`);
    return { error: error.message, ok: false };
  }
}

export { main };
