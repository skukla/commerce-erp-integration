import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { erpsProblem, loadErps, readStoredErps, replaceErps } from "#lib/erps";
import { readPayload } from "#lib/webhook";

/**
 * The ERP list (lib/erps.js).
 * GET: `{ entries, stored }`: the list the integration serves, and whether it was stored (else
 *   it is the single ERP from the deployed settings).
 * PUT `{ entries: [{ id, name, adapter, connection: { baseUrl } }] }`: replace the whole list.
 *   Demo Builder sends it when an SC adds or removes an ERP. Answers how many ERPs it holds.
 */
async function main(params) {
  const logger = AioLogger("erp-erps", { level: params.LOG_LEVEL || "info" });
  const method = String(params.__ow_method || "get").toLowerCase();
  try {
    if (method === "get") {
      const stored = (await readStoredErps()).length > 0;
      return ok({ body: { entries: await loadErps(params), stored } });
    }
    if (method === "put") {
      const { entries } = readPayload(params);
      const problem = erpsProblem(entries);
      if (problem) {
        return badRequest(problem);
      }
      await replaceErps(entries);
      logger.info(`ERP list replaced: ${entries.map((e) => e.id).join(", ")}`);
      return ok({ body: { entries: entries.length } });
    }
    return badRequest(`erps does not answer ${method.toUpperCase()}`);
  } catch (error) {
    logger.error(`erps failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
