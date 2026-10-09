import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { readRun, runProblem, trackRun } from "#lib/action-runs";
import * as commerce from "#lib/commerce";
import * as tierPrices from "#lib/commerce-tier-prices";
import * as balance from "#lib/company-balance";
import { detach } from "#lib/detach";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { clearHistory, recordReset } from "#lib/history";
import * as ledger from "#lib/ledger";
import * as orderParts from "#lib/order-parts";
import { clearScheduledRuns } from "#lib/scheduled-runs";

const NOT_FOUND = 404;

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

/** The params detach reads: `closeOrders` only as `true`, and only when asked for; never `run`. */
function detachParams(params) {
  const { closeOrders, run, ...rest } = params;
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

/** Why the run a caller named cannot be one, or null when it can (or none was named). */
const namedRunProblem = (params) =>
  params.run === undefined ? null : runProblem(params.run);

/** GET detach?run=<id>: how that run went. Reads one record; never detaches. */
async function answerRun(params) {
  if (params.run === undefined) {
    return badRequest(
      "detach answers GET only as detach?run=<id>, which reads how the detach POSTed with that run went; POST runs a detach",
    );
  }
  const problem = runProblem(params.run);
  if (problem) {
    return badRequest(problem);
  }
  const record = await readRun("detach", String(params.run));
  if (!record) {
    return buildErrorResponse(NOT_FOUND, {
      body: { message: `no detach run ${params.run}` },
    });
  }
  return ok({ body: record });
}

/** POST detach: undo, under the caller's run id when it named one. */
async function undo(params, logger) {
  // Every listed ERP's orders: detach undoes what the integration wrote for all of them.
  const erps = await loadErps(params);
  const problem =
    namedRunProblem(params) ??
    closeOneProblem(params) ??
    unlistedProblem(params, erps);
  if (problem) {
    return badRequest(problem);
  }
  const work = () =>
    detach(detachParams(params), {
      activity: { clearHistory, clearScheduledRuns, recordReset },
      balance,
      commerce,
      erp,
      erps,
      ledger,
      orderParts,
      tierPrices,
    });
  const result = await (params.run === undefined
    ? work()
    : trackRun("detach", String(params.run), work));
  logger.info(
    `detach${result.erp ? ` of ${result.erp}` : ""}: reverted ${result.reverted.reverted} Commerce change(s), cleared ${result.orders.cleared} order number(s)${closedSummary(result.closed)}`,
  );
  return ok({ body: result });
}

/**
 * POST detach[?erp=<id>]: undo what this integration wrote onto Commerce — company credit
 * limits and blocks, the prices and stock the ERP decided, the contract prices in shared
 * catalogs, and the ERP numbers on orders — without touching the ERP. Demo Builder runs it
 * before removing the integration; reset runs the same code before wiping the ERP. With `erp`
 * (query or body), only that listed ERP's writes are undone and the answer names it as `erp`
 * (AB-16c); an ERP not in the list is refused. With `closeOrders` (body true or query "true"),
 * every order the ERPs hold is also closed off in Commerce and the answer carries `closed`
 * (AB-16n, lib/close-orders.js); asked together with `erp` it is refused.
 *
 * With `run` (query or body: an id the caller chooses, 8 to 64 letters, digits, hyphens and
 * underscores; anything else is refused), the detach can be asked about afterwards
 * (lib/action-runs.js). A web action's HTTP answer is cut off at 60 seconds while the action
 * runs on, so a caller of a long detach sees a 504 for one that then finishes; the POST's own
 * answer is the same with or without `run`.
 *
 * GET detach?run=<id>: that run's record, `{ run, status: "running", startedAt }`, then
 * `{ run, status: "done", startedAt, finishedAt, result }` (`result` is the body the POST
 * answers) or `{ run, status: "failed", startedAt, finishedAt, error }`; 404 when no run was
 * started by that id, or it was more than a day ago. GET never detaches: only POST does, and
 * GET without `run`, or any other method, is refused.
 */
async function main(params) {
  const logger = AioLogger("erp-detach", { level: params.LOG_LEVEL || "info" });
  const method = String(params.__ow_method || "get").toLowerCase();
  try {
    if (method === "get") {
      return await answerRun(params);
    }
    if (method === "post") {
      return await undo(params, logger);
    }
    return badRequest(`detach does not answer ${method.toUpperCase()}`);
  } catch (error) {
    logger.error(`detach failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
