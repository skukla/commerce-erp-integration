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
import * as ledger from "#lib/ledger";

/** Why an asked-for ERP cannot be undone, or null when it can (or none was asked for). */
function unlistedProblem(params, erps) {
  if (!params.erp || erps.some((entry) => entry.id === String(params.erp))) {
    return null;
  }
  return `no ERP ${params.erp} in the list; the listed ERPs are ${erps
    .map((entry) => entry.id)
    .join(", ")}`;
}

/**
 * POST detach[?erp=<id>]: undo what this integration wrote onto Commerce — company credit
 * limits and blocks, the prices and stock the ERP decided, the contract prices in shared
 * catalogs, and the ERP numbers on orders — without touching the ERP. Demo Builder runs it
 * before removing the integration; reset runs the same code before wiping the ERP. With `erp`
 * (query or body), only that listed ERP's writes are undone and the answer names it as `erp`
 * (AB-16c); an ERP not in the list is refused.
 */
async function main(params) {
  const logger = AioLogger("erp-detach", { level: params.LOG_LEVEL || "info" });
  try {
    // Every listed ERP's orders: detach undoes what the integration wrote for all of them.
    const erps = await loadErps(params);
    const problem = unlistedProblem(params, erps);
    if (problem) {
      return badRequest(problem);
    }
    const result = await detach(params, {
      commerce,
      erp,
      erps,
      ledger,
      tierPrices,
    });
    logger.info(
      `detach${result.erp ? ` of ${result.erp}` : ""}: reverted ${result.reverted.reverted} Commerce change(s), cleared ${result.orders.cleared} order number(s)`,
    );
    return ok({ body: result });
  } catch (error) {
    logger.error(`detach failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
