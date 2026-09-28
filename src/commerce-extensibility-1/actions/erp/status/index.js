import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { paramsForErp } from "#adapters/contract";
import appConfig from "#app.commerce.config";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { readLedger } from "#lib/ledger";

/**
 * With several ERPs, each listed ERP by name with whether it answers, each asked at its own
 * address: the Admin page header names them all (slice B7). Undefined with one ERP, or when
 * the list cannot be read, so the answer is as before.
 */
async function listedErps(params) {
  let erps;
  try {
    erps = await loadErps(params);
  } catch {
    return;
  }
  if (erps.length <= 1) {
    return;
  }
  return Promise.all(
    erps.map((entry) =>
      erp.health(paramsForErp(params, entry)).then(
        () => ({ id: entry.id, name: entry.name, reachable: true }),
        (error) => ({
          error: error.message,
          id: entry.id,
          name: entry.name,
          reachable: false,
        }),
      ),
    ),
  );
}

/**
 * GET status: the ERP's health as the integration sees it, the ledger size, and what
 * this app declares. The flyout's status tool and the Admin screen read this. With several
 * ERPs, `erps` lists each by name with whether it answers.
 */
async function main(params) {
  const logger = AioLogger("erp-status", { level: params.LOG_LEVEL || "info" });
  try {
    let health = { ok: false, reachable: false };
    try {
      const res = await erp.health(params);
      health = {
        reachable: true,
        status: res.status,
        ...(res.ok ? res.data : { error: res.data?.errorMessage, ok: false }),
      };
    } catch (error) {
      health = { error: error.message, ok: false, reachable: false };
    }
    const [ledger, erps] = await Promise.all([
      readLedger(),
      listedErps(params),
    ]);
    return ok({
      body: {
        app: { id: appConfig.metadata.id, version: appConfig.metadata.version },
        erp: health,
        erpBaseUrl: params.ERP_BASE_URL || null,
        ...(erps ? { erps } : {}),
        ledger: { entries: ledger.length },
      },
    });
  } catch (error) {
    logger.error(`status failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
