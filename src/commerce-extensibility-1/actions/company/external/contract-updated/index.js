import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { contractPriceDeps } from "#lib/contract-price-deps";
import { applyCustomerPrices } from "#lib/contract-prices";
import { recordingErpEvent } from "#lib/erp-event-history";
import { eventErpId, loadErps } from "#lib/erps";
import { stringParameters } from "#lib/utils";

/** One sentence for the history and the logs: what the apply did. */
function summary(partnerId, result) {
  const done = `partner ${partnerId}: ${result.written} tier price(s) written, ${result.removed} removed, ${result.unchanged} unchanged`;
  return result.skipped ? `${done}; skipped: ${result.skipped}` : done;
}

/**
 * be-observer.company_contract_update (contract version 7, raised by contract.changed): one
 * customer's WHOLE set of prices in force, its price group already resolved in the ERP (each
 * line's `appliesTo` says which list it came from; nothing here branches on it). Applied as a
 * replace into the company's shared catalog for the ERP the event names (lib/contract-
 * prices.js; lib/erps.js eventErpId), so a redelivery changes nothing. A partner with no
 * Commerce company, or a company with no custom shared catalog, is applied as a skip with
 * the reason. The ERP raises nothing when a date starts or ends a price: erp/prices follows
 * those.
 */
async function handle(params) {
  const logger = AioLogger("company-external-contract-updated", {
    level: params.LOG_LEVEL || "info",
  });
  logger.debug(`Received params: ${stringParameters(params)}`);
  const { partnerId, lines } = params.data ?? {};
  if (!partnerId) {
    return badRequest("the event names no partner (partnerId)");
  }
  if (!Array.isArray(lines)) {
    return badRequest("the event carries no list of lines");
  }
  const erps = await loadErps(params);
  const erpId = eventErpId(erps, params.data?.erpId);
  if (!erpId) {
    return badRequest("with several ERPs the event must name its ERP (erpId)");
  }
  try {
    const result = await applyCustomerPrices(
      params,
      { erpId, lines, partnerId },
      contractPriceDeps(params, erps, erpId),
    );
    const said = summary(partnerId, result);
    logger.info(said);
    return ok(said);
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("contract", handle);

export { main };
