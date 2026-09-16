import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import * as commerce from "#lib/commerce";
import { detach } from "#lib/detach";
import { erp } from "#lib/erp";
import * as ledger from "#lib/ledger";
import { runMirror } from "#lib/mirror-run";

/**
 * POST reset: the whole reset in the order the plan fixes (decisions 8 and 11):
 * undo what was written onto Commerce (ledgered company writes, ERP numbers on orders) →
 * wipe the ERP → re-mirror Commerce as it stands. Idempotent; reports counts. The ERP's
 * order counter never rewinds.
 */
async function main(params) {
  const logger = AioLogger("erp-reset", { level: params.LOG_LEVEL || "info" });
  const report = {};
  try {
    const undone = await detach(params, { commerce, erp, ledger });
    report.reverted = undone.reverted;
    report.orders = undone.orders;
    if (report.reverted.failed.length > 0) {
      logger.warn(
        `reset: ${report.reverted.failed.length} company revert(s) failed; they stay in the ledger`,
      );
    }
    const wiped = await erp.wipe(params);
    if (!wiped.ok) {
      throw new Error(
        `ERP wipe answered ${wiped.status}: ${wiped.data?.errorMessage || "unknown error"}`,
      );
    }
    report.wiped = wiped.data.wiped;
    report.mirrored = await runMirror(params);
    logger.info(
      `reset: reverted ${report.reverted.reverted}, wiped, mirrored ${report.mirrored.counts.products} products and ${report.mirrored.counts.companies} companies`,
    );
    return ok({ body: report });
  } catch (error) {
    logger.error(`reset failed: ${error.message}`);
    return internalServerError(error.message, {
      body: { ...report, error: error.message },
    });
  }
}

export { main };
