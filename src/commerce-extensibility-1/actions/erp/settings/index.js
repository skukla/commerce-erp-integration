import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { saveProblem, saveSettings, settingsPage } from "#lib/settings";
import { readPayload } from "#lib/webhook";

/**
 * The Admin page's settings.
 * GET ?scope=<scope id>: the fields, the scopes a merchant can pick, and the values at
 *   that scope with where each comes from (Default Config when no scope is given).
 * PATCH { scope?, values: { <setting>: true | false | null } }: save at that scope;
 *   null removes the override so the wider scope's value applies. Answers the page as
 *   it now reads.
 */
async function main(params) {
  const logger = AioLogger("erp-settings", {
    level: params.LOG_LEVEL || "info",
  });
  const method = String(params.__ow_method || "get").toLowerCase();
  try {
    if (method === "get") {
      return ok({
        body: await settingsPage(params, params.scope || undefined),
      });
    }
    if (method === "patch") {
      const body = readPayload(params);
      const problem = saveProblem(body.values);
      if (problem) {
        return badRequest(problem);
      }
      await saveSettings(body.scope || undefined, body.values);
      logger.info(
        `settings saved at ${body.scope || "default"}: ${Object.keys(body.values).join(", ")}`,
      );
      return ok({ body: await settingsPage(params, body.scope || undefined) });
    }
    return badRequest(`settings does not answer ${method.toUpperCase()}`);
  } catch (error) {
    logger.error(`settings failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
