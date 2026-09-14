import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import * as commerce from "#lib/commerce";
import { drain } from "#lib/drain";
import { erp } from "#lib/erp";
import * as ledger from "#lib/ledger";

/** Drain the ERP's outbox into Commerce. Runs every minute from the alarm trigger and on demand. */
async function main(params) {
  const logger = AioLogger("erp-drain", { level: params.LOG_LEVEL || "info" });
  try {
    const result = await drain(params, {
      commerce,
      erp,
      erpName: params.ERP_DISPLAY_NAME,
      ledger,
    });
    if (
      result.applied.length + result.failed.length + result.skipped.length >
      0
    ) {
      logger.info(
        `drain: ${result.applied.length} applied, ${result.skipped.length} skipped, ${result.failed.length} failed`,
      );
    }
    for (const failure of result.failed) {
      logger.warn(
        `drain: ${failure.kind} ${failure.id} failed: ${failure.error}`,
      );
    }
    return ok({ body: result });
  } catch (error) {
    logger.error(`drain failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
