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
 * Why an ERP that answered its health cannot be used, or undefined when it can: an ERP in its
 * maintenance window (contract version 8) answers health and refuses every other call with 503
 * until the window ends, so it is not reachable, and its health says until when.
 */
const maintenanceReason = (data) => data?.maintenance?.message;

/**
 * What the Admin page's Overview shows per ERP, as far as its health gives it: its figures, and
 * how it looks (demo-erp's `appearance`, whose palette colors the ERP on the page).
 */
const FIGURES = ["appearance", "counts", "lastImportAt", "lastWipeAt"];

function figuresOf(data) {
  return Object.fromEntries(
    FIGURES.filter((key) => data?.[key] !== undefined).map((key) => [
      key,
      data[key],
    ]),
  );
}

/**
 * One listed ERP by name with whether the integration can use it, and its own figures (counts,
 * last fill and wipe) for the Overview. The ERP client never throws on
 * an HTTP error, so an ERP that answers but refuses the call (Bodea 2026-09-28: 401 from an ERP
 * in another workspace) is not reachable, with the status it answered.
 */
function listedHealth(params, entry) {
  const named = { id: entry.id, name: entry.name };
  return erp.health(paramsForErp(params, entry)).then(
    (res) => {
      if (!res.ok) {
        return {
          error: `the ERP answered ${res.status}`,
          ...named,
          reachable: false,
        };
      }
      const why = maintenanceReason(res.data);
      const figures = figuresOf(res.data);
      return why
        ? { ...figures, error: why, ...named, reachable: false }
        : { ...figures, ...named, reachable: true };
    },
    (error) => ({ error: error.message, ...named, reachable: false }),
  );
}

/**
 * One ERP's full health, asked at its address. Like the list, an ERP that answers but refuses
 * the call is not reachable: the integration cannot use it. Nor is one in maintenance, whose
 * health is given whole with the reason. The refusal is the ERP's own
 * `errorMessage`, else Adobe's caller check's `error`, else the status it answered.
 */
async function healthOf(params) {
  try {
    const res = await erp.health(params);
    const why = res.ok ? maintenanceReason(res.data) : undefined;
    if (why) {
      return {
        ...res.data,
        error: why,
        ok: false,
        reachable: false,
        status: res.status,
      };
    }
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
 * `detachesPerErp` says erp/detach honours `erp` (AB-16c): a deployment from before it ignores
 * `erp` and undoes every ERP, so a caller checks this before asking for one ERP.
 * `closesOrdersOnReset` says erp/detach honours `closeOrders` (AB-16n): a deployment from before
 * it ignores the flag and leaves every order open, so a reset checks this first.
 * `detachRuns` says erp/detach answers `GET detach?run=<id>` with how a named run went
 * (lib/detach-runs.js): a deployment from before it ignores the method and would RUN a detach
 * on that GET, so a caller checks this before it polls.
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
        closesOrdersOnReset: true,
        detachesPerErp: true,
        detachRuns: true,
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
