import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { keyMapProblem, readKeyMap, replaceKeyMap } from "#lib/key-map";
import { readPayload } from "#lib/webhook";

/**
 * The key map (lib/key-map.js).
 * GET: `{ entries }`, every pair.
 * PUT `{ entries: [{ kind, commerce, erp }] }`: replace the whole map. Demo Builder sends it
 *   after each fill, the way a key map is loaded at a go-live. Answers how many rows it holds.
 */
async function main(params) {
  const logger = AioLogger("erp-keymap", { level: params.LOG_LEVEL || "info" });
  const method = String(params.__ow_method || "get").toLowerCase();
  try {
    if (method === "get") {
      return ok({ body: { entries: await readKeyMap() } });
    }
    if (method === "put") {
      const { entries } = readPayload(params);
      const problem = keyMapProblem(entries);
      if (problem) {
        return badRequest(problem);
      }
      await replaceKeyMap(entries);
      logger.info(`key map replaced: ${entries.length} rows`);
      return ok({ body: { entries: entries.length } });
    }
    return badRequest(`keymap does not answer ${method.toUpperCase()}`);
  } catch (error) {
    logger.error(`keymap failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
