import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { readRun, runProblem, trackRun } from "#lib/action-runs";
import { closeStoreOrders, resolveScope } from "#lib/close-store-orders";
import * as commerce from "#lib/commerce";
import * as storeScope from "#lib/commerce-store-scope";
import * as orderParts from "#lib/order-parts";
import { scopeIsEmpty, scopeOf } from "#lib/store-scope";
import * as orderClient from "#src/order/commerce-order-api-client";

const NOT_FOUND = 404;
const KIND = "close-orders";

/** The day the notes name, UTC, as YYYY-MM-DD. */
const today = () => new Date().toISOString().slice(0, 10);

/** Why the call cannot close anything, before anything is read; or null when it can. */
function requestProblem(params, scope) {
  if (params.erp) {
    return `close-orders closes the orders of every ERP the integration serves, so it cannot be asked for one ERP (erp=${params.erp})`;
  }
  if (scopeIsEmpty(scope)) {
    return "name the stores (stores) or websites (websites) whose orders to close, by code";
  }
  return params.run === undefined ? null : runProblem(params.run);
}

/** GET close-orders?run=<id>: how that run went. Reads one record; never closes. */
async function answerRun(params) {
  if (params.run === undefined) {
    return badRequest(
      "close-orders answers GET only as close-orders?run=<id>, which reads how the close POSTed with that run went; POST closes",
    );
  }
  const problem = runProblem(params.run);
  if (problem) {
    return badRequest(problem);
  }
  const record = await readRun(KIND, String(params.run));
  if (!record) {
    return buildErrorResponse(NOT_FOUND, {
      body: { message: `no close-orders run ${params.run}` },
    });
  }
  return ok({ body: record });
}

/** POST close-orders: resolve the scope, then close, under the caller's run id when it named one. */
async function close(params, logger) {
  const scope = scopeOf(params);
  const problem = requestProblem(params, scope);
  if (problem) {
    return badRequest(problem);
  }
  const deps = { commerce, orderClient, orderParts, storeScope, today };
  const { viewIds, unknown } = await resolveScope(params, scope, deps);
  if (unknown.length > 0) {
    return badRequest(
      `the store has no ${unknown.join(", ")}; nothing was closed`,
    );
  }
  const { erp: _erp, run, stores: _s, websites: _w, ...rest } = params;
  const work = () => closeStoreOrders(rest, scope, viewIds, deps);
  const result = await (run === undefined
    ? work()
    : trackRun(KIND, String(run), work));
  const { closed } = result;
  logger.info(
    `close-orders in views ${viewIds.join(", ") || "(none)"}: cancelled ${closed.cancelled}, refunded ${closed.refunded}, left open ${closed.commented}, already closed ${closed.alreadyClosed}, closed ${closed.returnsClosed} return(s), ${closed.failed.length} failed`,
  );
  return ok({ body: result });
}

/**
 * POST close-orders: close the orders placed in some stores only, by the one reset rule (owner,
 * 2026-10-30; lib/close-store-orders.js). Demo Builder's store wipe calls it for a store an ERP
 * serves, so the ERP never hears of the orders it clears; it then fills the ERP from Commerce.
 * The scope, in a body or a query: `stores` (store codes, Commerce's store groups) and/or
 * `websites` (website codes, every store of each), as lists or comma-separated. Every order
 * placed in their store views is closed: canceled, refunded or noted, its returns closed, its
 * parts record, ERP number and hold forgotten, each marked closed before the first write so no
 * event it raises reaches an ERP. No other order is touched, the ERP is not wiped, and no
 * ledgered write is undone: that is erp/detach's whole reset.
 *
 * Refused with a 400 before anything is written: `erp` (the close is the whole integration's),
 * no store or website named, a code the store does not have. A scope with no orders in it closes
 * nothing and answers so.
 *
 * Answers `{ scope: { stores, websites, storeViewIds }, closed: { cancelled, refunded, commented,
 * alreadyClosed, returnsClosed, partsRemoved, failed }, touched: [{ orderId, outcome }],
 * orders: { cleared, failed }, holds: { released, failed } }`. With `run` (8 to 64 letters,
 * digits, hyphens and underscores), `GET close-orders?run=<id>` answers the run's record, as
 * erp/detach's does (lib/action-runs.js): a web action's answer is cut off at 60 seconds while
 * the close runs on.
 */
async function main(params) {
  const logger = AioLogger("erp-close-orders", {
    level: params.LOG_LEVEL || "info",
  });
  const method = String(params.__ow_method || "get").toLowerCase();
  try {
    if (method === "get") {
      return await answerRun(params);
    }
    if (method === "post") {
      return await close(params, logger);
    }
    return badRequest(`close-orders does not answer ${method.toUpperCase()}`);
  } catch (error) {
    logger.error(`close-orders failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
