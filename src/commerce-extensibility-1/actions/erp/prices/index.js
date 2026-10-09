import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { readRun, runProblem, trackRun } from "#lib/action-runs";
import { describePublish, pickErps, publishTo } from "#lib/publish-prices";
import { readPayload } from "#lib/webhook";

const NOT_FOUND = 404;

/** The run a caller named, from the body or the query, or undefined when none was. */
const namedRun = (params) => readPayload(params).run ?? params.run;

/** GET prices?run=<id>: how that publish went. Reads one record; never publishes. */
async function answerRun(params) {
  const run = namedRun(params);
  if (run === undefined) {
    return badRequest(
      "prices answers GET only as prices?run=<id>, which reads how the publish POSTed with that run went; POST publishes",
    );
  }
  const problem = runProblem(run);
  if (problem) {
    return badRequest(problem);
  }
  const record = await readRun("prices", String(run));
  if (!record) {
    return buildErrorResponse(NOT_FOUND, {
      body: { message: `no prices run ${run}` },
    });
  }
  return ok({ body: record });
}

/** POST prices: publish, under the caller's run id when it named one. */
async function publish(params, logger) {
  const run = namedRun(params);
  const problem = run === undefined ? null : runProblem(run);
  if (problem) {
    return badRequest(problem);
  }
  const picked = await pickErps(params, readPayload(params).erpId);
  if (picked.problem) {
    return badRequest(picked.problem);
  }
  const work = () => publishTo(params, picked.erps, picked.targets);
  const result = await (run === undefined
    ? work()
    : trackRun("prices", String(run), work));
  logger.info(describePublish(result));
  return ok({ body: result });
}

/**
 * POST erp/prices `{ erpId?, run? }`: publish every customer's ERP contract prices in force
 * into the companies' shared catalogs as tier prices (lib/publish-prices.js), for one ERP or
 * every ERP. Demo Builder calls it after a fill; it may be run again at any time, and
 * erp/scheduled runs the same publish on its schedule so price dates take effect. Answers
 * `{ erps, written, removed, unchanged, skipped: [{ erpId, partnerId, reason }], failed }`.
 *
 * With `run` (body or query: an id the caller chooses, 8 to 64 letters, digits, hyphens and
 * underscores; anything else is refused), the publish can be asked about afterwards
 * (lib/action-runs.js). A web action's HTTP answer is cut off at 60 seconds while the action
 * runs on, so a caller of a long publish sees "not yet ready" for one that then finishes; the
 * POST's own answer is the same with or without `run`.
 *
 * GET prices?run=<id>: that run's record, `{ run, status: "running", startedAt }`, then
 * `{ run, status: "done", startedAt, finishedAt, result }` (`result` is the body the POST
 * answers) or `{ run, status: "failed", startedAt, finishedAt, error }`; 404 when no publish
 * was started by that id, or it was more than a day ago. GET never publishes: only POST does,
 * and GET without `run`, or any other method, is refused.
 */
async function main(params) {
  const logger = AioLogger("erp-prices", { level: params.LOG_LEVEL || "info" });
  const method = String(params.__ow_method || "get").toLowerCase();
  try {
    if (method === "get") {
      return await answerRun(params);
    }
    if (method === "post") {
      return await publish(params, logger);
    }
    return badRequest(`prices does not answer ${method.toUpperCase()}`);
  } catch (error) {
    logger.error(`prices failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
