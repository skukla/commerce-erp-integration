import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { COMPANY_STATUS, getCompany, setCompanyStatus } from "#lib/commerce";
import { recordCompanyWrite } from "#lib/ledger";
import { stringParameters } from "#lib/utils";

/** be-observer.company_status_update: the ERP blocked or unblocked an account; ledgered so reset can undo it. */
async function main(params) {
  const logger = AioLogger("company-external-status-updated", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const { companyId, blocked } = params.data ?? {};
  if (!companyId) {
    return ok("Skipped: the partner has no Commerce company");
  }
  if (typeof blocked !== "boolean") {
    return badRequest("the event carries no blocked flag");
  }
  try {
    const company = await getCompany(params, companyId);
    const status = blocked ? COMPANY_STATUS.BLOCKED : COMPANY_STATUS.APPROVED;
    await setCompanyStatus(params, companyId, status);
    await recordCompanyWrite({
      after: status,
      before: Number(company.status),
      companyId,
      field: "status",
    });
    return ok(`Company ${blocked ? "blocked" : "unblocked"} successfully`);
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
