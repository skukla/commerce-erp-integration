import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import {
  erpsProblem,
  loadErps,
  readStoredErps,
  replaceErps,
  updateErpSettings,
} from "#lib/erps";
import { readPayload } from "#lib/webhook";

/**
 * The ERP list (lib/erps.js).
 * GET: `{ entries, stored }`: the list the integration serves, and whether it was stored (else
 *   it is the single ERP from the deployed settings).
 * PUT `{ entries: [{ id, name, adapter, connection: { baseUrl } }] }`: replace the whole list.
 *   Demo Builder sends it when an SC adds or removes an ERP. Answers how many ERPs it holds.
 *   An entry may carry `settings`, its own per-ERP settings (lib/erp-settings.js).
 * PATCH `{ id, website?, values: { <per-ERP setting>: value | null } }`: save one ERP's own
 *   settings (the Admin page), at its defaults or at one website; `null` removes a value so the
 *   wider one applies. Answers the entry as saved.
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
    if (method === "patch") {
      const { id, values, website } = readPayload(params);
      const { entry, problem } = await updateErpSettings(
        String(id ?? ""),
        website || undefined,
        values ?? {},
      );
      if (problem) {
        return badRequest(problem);
      }
      logger.info(
        `ERP ${entry.id} settings saved${website ? ` at ${website}` : ""}`,
      );
      return ok({ body: { entry } });
    }
    return badRequest(`erps does not answer ${method.toUpperCase()}`);
  } catch (error) {
    logger.error(`erps failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
