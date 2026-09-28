import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import {
  COMPANY_STATUS,
  getCompany,
  getOrderByIncrementId,
  setCompanyStatus,
} from "#lib/commerce";
import { recordingErpEvent } from "#lib/erp-event-history";
import { loadErps } from "#lib/erps";
import { companyOfErpEvent } from "#lib/key-map";
import { recordCompanyWrite } from "#lib/ledger";
import { orderSyncDeps } from "#lib/order-deps";
import { stringParameters } from "#lib/utils";
import { applyCombinedStatus } from "#router/combined-status";
import { applyErpBlock } from "#router/erp-blocks";
import { routeOrder } from "#router/route-order";
import { addComment, getOrder } from "#src/order/commerce-order-api-client";

/**
 * Several ERPs (design v1 §3.1, each brand for itself): the ERP's block holds only its parts
 * of the company's orders; the Commerce company's own flag is a group decision made in
 * Commerce and is never written here. The event must name its ERP.
 */
async function blockPerErp(params, blocked, erps, logger) {
  const erpId = params.data?.erpId;
  if (!erpId) {
    return badRequest("with several ERPs the event must name its ERP (erpId)");
  }
  const companyId = await companyOfErpEvent(params.data);
  if (!companyId) {
    return ok("Skipped: the partner has no Commerce company");
  }
  const result = await applyErpBlock(
    params,
    { blocked, companyId, erpId },
    {
      addComment,
      applyCombinedStatus,
      erps,
      getOrder: getOrderByIncrementId,
      getOrderState: async (p, orderId) => (await getOrder(p, orderId))?.state,
      reroute: (p, order) => routeOrder(p, order, orderSyncDeps(logger), erps),
    },
  );
  return ok(
    `${erpId} ${blocked ? "blocks" : "no longer blocks"} company ${companyId}: ${result.orders} order(s) changed`,
  );
}

/** be-observer.company_status_update: the ERP blocked or unblocked an account; ledgered so reset can undo it. */
async function handle(params) {
  const logger = AioLogger("company-external-status-updated", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const { blocked } = params.data ?? {};
  const erps = await loadErps(params);
  if (erps.length > 1) {
    if (typeof blocked !== "boolean") {
      return badRequest("the event carries no blocked flag");
    }
    try {
      return await blockPerErp(params, blocked, erps, logger);
    } catch (error) {
      logger.error(`Error processing the request: ${error.message}`);
      return internalServerError(error.message);
    }
  }
  const companyId = await companyOfErpEvent(params.data);
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

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("block", handle);

export { main };
