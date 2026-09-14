import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import * as commerce from "#lib/commerce";
import { erp } from "#lib/erp";
import { revertLedger } from "#lib/ledger";
import { mirror } from "#lib/mirror";

/**
 * POST reset: the whole reset in the order the plan fixes (decisions 8 and 11):
 * revert the ledgered company writes → wipe the ERP → re-mirror Commerce as it stands.
 * Idempotent; reports counts. The ERP's order counter never rewinds.
 */
async function main(params) {
  const logger = AioLogger("erp-reset", { level: params.LOG_LEVEL || "info" });
  const report = {};
  try {
    report.reverted = await revertLedger({
      creditLimit: (companyId, creditId, before) =>
        commerce.setCompanyCreditLimit(params, creditId, companyId, before),
      status: (companyId, before) =>
        commerce.setCompanyStatus(params, companyId, before),
    });
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
    report.mirrored = await mirror(params, commerce, erp, params.projectName);
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
