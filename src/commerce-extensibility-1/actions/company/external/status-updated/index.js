import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { getOrderByIncrementId } from "#lib/commerce";
import { recordingErpEvent } from "#lib/erp-event-history";
import { loadErps } from "#lib/erps";
import { companyOfErpEvent } from "#lib/key-map";
import { orderSyncDeps } from "#lib/order-deps";
import { stringParameters } from "#lib/utils";
import { applyCombinedStatus } from "#router/combined-status";
import { applyErpBlock } from "#router/erp-blocks";
import { routeOrder } from "#router/route-order";
import { addComment, getOrder } from "#src/order/commerce-order-api-client";

/**
 * be-observer.company_status_update: the ERP blocked or unblocked a customer. Each ERP for
 * itself (design v1 §3.1; one ERP too, owner 2026-09-28): the block holds only that ERP's
 * parts of the company's orders, open and new, with the reason in each order's history, and the
 * unblock releases them. The Commerce company's own active/blocked flag is a group decision
 * made in Commerce and is never written here. With several ERPs the event must name its ERP;
 * with one, it is that ERP.
 */
async function handle(params) {
  const logger = AioLogger("company-external-status-updated", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const { blocked } = params.data ?? {};
  if (typeof blocked !== "boolean") {
    return badRequest("the event carries no blocked flag");
  }
  try {
    const erps = await loadErps(params);
    const erpId = erps.length === 1 ? erps[0].id : params.data?.erpId;
    if (!erpId) {
      return badRequest(
        "with several ERPs the event must name its ERP (erpId)",
      );
    }
    const companyId = await companyOfErpEvent({ ...params.data, erpId });
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
        getOrder: (p, incrementId) => getOrderByIncrementId(p, incrementId),
        getOrderState: async (p, orderId) =>
          (await getOrder(p, orderId))?.state,
        reroute: (p, order) =>
          routeOrder(p, order, orderSyncDeps(logger), erps),
      },
    );
    return ok(
      `${erpId} ${blocked ? "blocks" : "no longer blocks"} company ${companyId}: ${result.orders} order(s) changed`,
    );
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("block", handle);

export { main };
