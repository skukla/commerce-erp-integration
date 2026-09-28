import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { paramsForErp } from "#adapters/contract";
import { contractPriceDeps } from "#lib/contract-price-deps";
import { publishErpPrices } from "#lib/contract-prices";
import { erp } from "#lib/erp";
import { erpById, loadErps } from "#lib/erps";
import { readPayload } from "#lib/webhook";

/** One ERP's prices in force, published; an ERP that does not answer touches nothing. */
async function publishOne(params, erps, entry) {
  const res = await erp.inForce(paramsForErp(params, entry));
  if (!res.ok) {
    return {
      failed: [
        {
          erpId: entry.id,
          error: `the ERP's prices in force answered ${res.status}`,
        },
      ],
      removed: 0,
      skipped: [],
      unchanged: 0,
      written: 0,
    };
  }
  return publishErpPrices(
    params,
    entry,
    res.data?.items ?? [],
    contractPriceDeps(params, erps, entry.id),
  );
}

/**
 * POST erp/prices `{ erpId? }`: publish every customer's ERP contract prices in force into
 * the companies' shared catalogs as tier prices (lib/contract-prices.js), for one ERP or
 * every ERP. Demo Builder calls it after a fill; it may be run again at any time. A price in
 * force has dates and a tier price has none, so a new run is also what adds a price whose
 * start has arrived and removes one whose end has passed. Answers
 * `{ erps, written, removed, unchanged, skipped: [{ erpId, partnerId, reason }], failed }`.
 */
async function main(params) {
  const logger = AioLogger("erp-prices", { level: params.LOG_LEVEL || "info" });
  if (String(params.__ow_method || "").toLowerCase() !== "post") {
    return badRequest("prices answers POST only");
  }
  try {
    const { erpId } = readPayload(params);
    const erps = await loadErps(params);
    const targets = erpId ? [erpById(erps, erpId)] : erps;
    if (targets.some((entry) => !entry)) {
      return badRequest(`no ERP ${erpId} in the list`);
    }
    const total = {
      erps: targets.map((e) => e.id),
      failed: [],
      removed: 0,
      skipped: [],
      unchanged: 0,
      written: 0,
    };
    for (const entry of targets) {
      // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time: one ledger document
      const result = await publishOne(params, erps, entry);
      total.written += result.written;
      total.removed += result.removed;
      total.unchanged += result.unchanged;
      total.skipped.push(...result.skipped);
      total.failed.push(...result.failed);
    }
    logger.info(
      `prices: wrote ${total.written}, removed ${total.removed}, skipped ${total.skipped.length}, failed ${total.failed.length}`,
    );
    return ok({ body: total });
  } catch (error) {
    logger.error(`prices failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
