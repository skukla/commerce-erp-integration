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

/** The ERP list, or an empty one when it cannot be read (the answer is then as with one ERP). */
async function readList(params) {
  try {
    return await loadErps(params);
  } catch {
    return [];
  }
}

/**
 * One listed ERP by name with whether the integration can use it. The ERP client never throws on
 * an HTTP error, so an ERP that answers but refuses the call (Bodea 2026-09-28: 401 from an ERP
 * in another workspace) is not reachable, with the status it answered.
 */
function listedHealth(params, entry) {
  const named = { id: entry.id, name: entry.name };
  return erp.health(paramsForErp(params, entry)).then(
    (res) =>
      res.ok
        ? { ...named, reachable: true }
        : {
            error: `the ERP answered ${res.status}`,
            ...named,
            reachable: false,
          },
    (error) => ({ error: error.message, ...named, reachable: false }),
  );
}

/**
 * One ERP's full health, asked at its address. Like the list, an ERP that answers but refuses
 * the call is not reachable: the integration cannot use it. The refusal is the ERP's own
 * `errorMessage`, else Adobe's caller check's `error`, else the status it answered.
 */
async function healthOf(params) {
  try {
    const res = await erp.health(params);
    if (res.ok) {
      return { reachable: true, status: res.status, ...res.data };
    }
    return {
      error:
        res.data?.errorMessage ??
        res.data?.error ??
        `the ERP answered ${res.status}`,
      ok: false,
      reachable: false,
      status: res.status,
    };
  } catch (error) {
    return { error: error.message, ok: false, reachable: false };
  }
}

/**
 * GET status[?erp=<id>]: the ERP's health as the integration sees it, the ledger size, and what
 * this app declares. The flyout's status tool and the Admin screen read this. With `erp`, the
 * health is that listed ERP's, asked at its address; else the ERP the app deployed with. With
 * several ERPs, `erps` lists each by name with whether the integration can use it (slice B7).
 */
async function main(params) {
  const logger = AioLogger("erp-status", { level: params.LOG_LEVEL || "info" });
  try {
    const list = await readList(params);
    const asked = list.find((entry) => entry.id === String(params.erp ?? ""));
    const target = asked ? paramsForErp(params, asked) : params;
    const [health, ledger, erps] = await Promise.all([
      healthOf(target),
      readLedger(),
      list.length > 1
        ? Promise.all(list.map((entry) => listedHealth(params, entry)))
        : undefined,
    ]);
    return ok({
      body: {
        app: { id: appConfig.metadata.id, version: appConfig.metadata.version },
        erp: health,
        erpBaseUrl: target.ERP_BASE_URL || null,
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
