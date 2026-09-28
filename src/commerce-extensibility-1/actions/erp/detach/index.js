import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import * as commerce from "#lib/commerce";
import * as tierPrices from "#lib/commerce-tier-prices";
import { detach } from "#lib/detach";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { clearHistory, recordReset } from "#lib/history";
import * as ledger from "#lib/ledger";
import * as orderParts from "#lib/order-parts";
import { clearScheduledRuns } from "#lib/scheduled-runs";

/** Why an asked-for ERP cannot be undone, or null when it can (or none was asked for). */
function unlistedProblem(params, erps) {
  if (!params.erp || erps.some((entry) => entry.id === String(params.erp))) {
    return null;
  }
  return `no ERP ${params.erp} in the list; the listed ERPs are ${erps
    .map((entry) => entry.id)
    .join(", ")}`;
}

/** Whether the caller asked to close the orders: `true` in a body, `"true"` in a query. */
const asksToClose = (params) =>
  params.closeOrders === true || params.closeOrders === "true";

/** The params detach reads: `closeOrders` only as `true`, and only when asked for. */
function detachParams(params) {
  const { closeOrders, ...rest } = params;
  return asksToClose(params) ? { ...rest, closeOrders: true } : rest;
}

/** Why closing the orders cannot be asked for one ERP, or null when it was not. */
function closeOneProblem(params) {
  if (!(asksToClose(params) && params.erp)) {
    return null;
  }
  return `closeOrders closes every order all the ERPs hold, so it cannot be asked for one ERP (erp=${params.erp}); ask for one or the other`;
}

/** The close's counts for the log line, or nothing when the orders were not closed. */
const closedSummary = (closed) =>
  closed
    ? `, cancelled ${closed.cancelled} order(s), noted ${closed.commented}, ${closed.failed.length} failed`
    : "";

/**
 * POST detach[?erp=<id>]: undo what this integration wrote onto Commerce — company credit
 * limits and blocks, the prices and stock the ERP decided, the contract prices in shared
 * catalogs, and the ERP numbers on orders — without touching the ERP. Demo Builder runs it
 * before removing the integration; reset runs the same code before wiping the ERP. With `erp`
 * (query or body), only that listed ERP's writes are undone and the answer names it as `erp`
 * (AB-16c); an ERP not in the list is refused. With `closeOrders` (body true or query "true"),
 * every order the ERPs hold is also closed off in Commerce and the answer carries `closed`
 * (AB-16n, lib/close-orders.js); asked together with `erp` it is refused.
 */
async function main(params) {
  const logger = AioLogger("erp-detach", { level: params.LOG_LEVEL || "info" });
  try {
    // Every listed ERP's orders: detach undoes what the integration wrote for all of them.
    const erps = await loadErps(params);
    const problem = closeOneProblem(params) ?? unlistedProblem(params, erps);
    if (problem) {
      return badRequest(problem);
    }
    const result = await detach(detachParams(params), {
      activity: { clearHistory, clearScheduledRuns, recordReset },
      commerce,
      erp,
      erps,
      ledger,
      orderParts,
      tierPrices,
    });
    logger.info(
      `detach${result.erp ? ` of ${result.erp}` : ""}: reverted ${result.reverted.reverted} Commerce change(s), cleared ${result.orders.cleared} order number(s)${closedSummary(result.closed)}`,
    );
    return ok({ body: result });
  } catch (error) {
    logger.error(`detach failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
