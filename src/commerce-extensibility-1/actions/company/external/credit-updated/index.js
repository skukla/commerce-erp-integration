import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { getCompanyCredit, setCompanyCreditLimit } from "#lib/commerce";
import { recordingErpEvent } from "#lib/erp-event-history";
import { recordCompanyWrite } from "#lib/ledger";
import { stringParameters } from "#lib/utils";

/** be-observer.company_credit_update: the ERP changed an account's credit limit; ledgered so reset can undo it. */
async function handle(params) {
  const logger = AioLogger("company-external-credit-updated", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const { companyId, creditLimit } = params.data ?? {};
  if (!companyId) {
    return ok("Skipped: the partner has no Commerce company");
  }
  if (!Number.isFinite(Number(creditLimit))) {
    return badRequest("the event carries no creditLimit");
  }
  try {
    const credit = await getCompanyCredit(params, companyId);
    await setCompanyCreditLimit(
      params,
      credit.id,
      companyId,
      Number(creditLimit),
    );
    await recordCompanyWrite({
      after: Number(creditLimit),
      before: Number(credit.credit_limit ?? 0),
      companyId,
      extra: { creditId: credit.id },
      field: "creditLimit",
    });
    return ok("Company credit limit updated successfully");
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("credit", handle);

export { main };
