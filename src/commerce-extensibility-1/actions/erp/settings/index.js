import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { pendingOrderStatuses } from "#lib/commerce-admin-reads";
import { withErpSettings } from "#lib/erp-settings";
import { erpById, loadErps } from "#lib/erps";
import {
  resolvedSettings,
  saveProblem,
  saveSettings,
  settingsPage,
} from "#lib/settings";
import { readPayload } from "#lib/webhook";
import { ownershipOf } from "#router/ownership";

/** A Commerce website code: letters, digits and underscores, starting with a letter. */
const WEBSITE_CODE = /^[a-z][a-z0-9_]*$/u;

/** One ERP's resolved settings: its own on top of the integration's, per website. */
async function settingsForErp(params, resolved) {
  const erps = await loadErps(params);
  const entry = erpById(erps, String(params.erp));
  if (!entry) {
    return badRequest(`no ERP ${params.erp} in the list`);
  }
  // One ERP owns every product, as routing passes the whole order to it.
  const owns = erps.length > 1 ? ownershipOf(entry) : {};
  return ok({
    body: {
      default: { ...withErpSettings(resolved.default, entry), ...owns },
      websites: Object.fromEntries(
        Object.entries(resolved.websites).map(([code, values]) => [
          code,
          { ...withErpSettings(values, entry, code), ...owns },
        ]),
      ),
    },
  });
}

/**
 * The Admin page's settings.
 * GET ?websites=<code>,<code>[&erp=<id>]: the settings in force, Default Config and each named
 *   website's (Demo Builder reads them before it fills the ERP). With `erp`, that ERP's own
 *   settings (lib/erp-settings.js) sit on top, per website; with several ERPs its ownership is
 *   the one routing uses (router/ownership.js), so the fill gives each ERP only what it owns.
 * GET ?scope=<scope id>[&refresh=true]: the fields, the scopes a merchant can pick, and the
 *   values at that scope with where each comes from (Default Config when no scope is given).
 *   `refresh` reads Commerce's websites again first. `confirmStatuses` lists the order statuses
 *   "Order status when the ERP confirms" can take (lib/commerce-admin-reads.js), or is null
 *   when Commerce's statuses could not be read (the page then offers a text box).
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
    if (method === "get" && params.websites !== undefined) {
      const codes = String(params.websites)
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean);
      if (codes.some((code) => !WEBSITE_CODE.test(code))) {
        return badRequest(
          "websites is a comma-separated list of website codes",
        );
      }
      const resolved = await resolvedSettings(codes, logger);
      if (params.erp === undefined) {
        return ok({ body: resolved });
      }
      return await settingsForErp(params, resolved);
    }
    if (method === "get") {
      const [page, confirmStatuses] = await Promise.all([
        settingsPage(params, params.scope || undefined, {
          refresh: String(params.refresh) === "true",
        }),
        pendingOrderStatuses(params).catch((error) => {
          logger.warn(`order statuses not read: ${error.message}`);
          return null;
        }),
      ]);
      return ok({ body: { ...page, confirmStatuses } });
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
