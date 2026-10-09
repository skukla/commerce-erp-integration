/*
 * Publish the ERPs' contract prices in force into the companies' shared catalogs: read each
 * ERP's GET contracts/in-force at its own address and apply it as a replace
 * (lib/contract-prices.js). Shared by erp/prices (Demo Builder, after a fill) and
 * erp/scheduled (the price publish on its schedule setting), so both publish the same way.
 */
import { paramsForErp } from "#adapters/contract";
import { contractPriceDeps } from "#lib/contract-price-deps";
import { publishErpPrices } from "#lib/contract-prices";
import { erp } from "#lib/erp";
import { erpById, loadErps } from "#lib/erps";
import { ownershipReaders } from "#lib/ownership-readers";

/** One ERP's prices in force, published; an ERP that does not answer touches nothing. */
async function publishOne(params, erps, entry, readers) {
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
    contractPriceDeps(params, erps, entry.id, readers),
  );
}

/**
 * The ERPs a publish is for, resolved before any work so a refusal costs nothing.
 * @param {object} params action params
 * @param {string} [erpId] one ERP, or every ERP when absent
 * @returns {Promise<{ problem: string } | { erps: object[], targets: object[] }>} the whole
 *   list and the entries to publish, or why the asked-for ERP cannot be
 */
export async function pickErps(params, erpId) {
  const erps = await loadErps(params);
  const targets = erpId ? [erpById(erps, erpId)] : erps;
  if (targets.some((entry) => !entry)) {
    return { problem: `no ERP ${erpId} in the list` };
  }
  return { erps, targets };
}

/**
 * Publish the picked ERPs' prices in force, one ERP at a time.
 * @param {object} params action params
 * @param {object[]} erps the whole ERP list (a SKU's owner may be any of them)
 * @param {object[]} targets the entries to publish
 * @returns {Promise<{ erps: string[], written: number, removed: number, unchanged: number,
 *   skipped: object[], failed: object[] }>}
 */
export async function publishTo(params, erps, targets) {
  const total = {
    erps: targets.map((e) => e.id),
    failed: [],
    removed: 0,
    skipped: [],
    unchanged: 0,
    written: 0,
  };
  // One set of readers for every ERP: a SKU's owner is read from Commerce once per publish.
  const readers = ownershipReaders();
  for (const entry of targets) {
    // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time: one ledger document
    const result = await publishOne(params, erps, entry, readers);
    total.written += result.written;
    total.removed += result.removed;
    total.unchanged += result.unchanged;
    total.skipped.push(...result.skipped);
    total.failed.push(...result.failed);
  }
  return total;
}

/**
 * `pickErps` then `publishTo` in one call, for erp/scheduled.
 * @param {object} params action params
 * @param {string} [erpId] one ERP, or every ERP when absent
 * @returns {Promise<{ problem: string } | { erps: string[], written: number,
 *   removed: number, unchanged: number, skipped: object[], failed: object[] }>}
 */
export async function publishPrices(params, erpId) {
  const picked = await pickErps(params, erpId);
  return picked.problem
    ? picked
    : publishTo(params, picked.erps, picked.targets);
}

/** One line for the logs. */
export function describePublish(total) {
  return `prices: wrote ${total.written}, removed ${total.removed}, unchanged ${total.unchanged}, skipped ${total.skipped.length}, failed ${total.failed.length}`;
}
