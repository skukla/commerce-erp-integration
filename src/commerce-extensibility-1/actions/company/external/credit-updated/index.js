import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import {
  getCompany,
  getCompanyCredit,
  setCompanyCreditLimit,
  setCompanyCustomAttributes,
} from "#lib/commerce";
import { applyErpCredit } from "#lib/erp-credit";
import { recordingErpEvent } from "#lib/erp-event-history";
import { eventErpId, loadErps } from "#lib/erps";
import { companyOfErpEvent } from "#lib/key-map";
import { recordCompanyWrite } from "#lib/ledger";
import { stringParameters } from "#lib/utils";

/**
 * Several ERPs (design v1 §3.1): the ERP's limit (and exposure and available credit when it
 * sends them) goes to its own company attributes, and Commerce's limit becomes the total
 * across the ERPs (lib/erp-credit.js). The event must name its ERP, unless it is the first
 * ERP's (lib/erps.js eventErpId).
 */
async function creditPerErp(params, erps, logger) {
  const { creditLimit, exposure, available } = params.data ?? {};
  const erpId = eventErpId(erps, params.data?.erpId);
  if (!erpId) {
    return badRequest("with several ERPs the event must name its ERP (erpId)");
  }
  if (!Number.isFinite(Number(creditLimit))) {
    return badRequest("the event carries no creditLimit");
  }
  const companyId = await companyOfErpEvent(params.data);
  if (!companyId) {
    return ok("Skipped: the partner has no Commerce company");
  }
  try {
    const { total } = await applyErpCredit(
      params,
      {
        available,
        companyId,
        creditLimit: Number(creditLimit),
        erpId,
        exposure,
      },
      {
        erps,
        getCompany,
        getCompanyCredit,
        recordCompanyWrite,
        setCompanyCreditLimit,
        setCompanyCustomAttributes,
      },
    );
    return ok(`Company credit limit is now ${total} across the ERPs`);
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** be-observer.company_credit_update: the ERP changed an account's credit limit; ledgered so reset can undo it. */
async function handle(params) {
  const logger = AioLogger("company-external-credit-updated", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const { creditLimit } = params.data ?? {};
  const erps = await loadErps(params);
  if (erps.length > 1) {
    return creditPerErp(params, erps, logger);
  }
  const companyId = await companyOfErpEvent(params.data);
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
      // The one ERP there is (lib/erps.js eventErpId), so its reset undoes this (AB-16c).
      erpId: eventErpId(erps),
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
