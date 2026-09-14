/*
 * The ledger of what this integration changed on Commerce COMPANIES: credit limits and
 * blocks the ERP decided. Reset reverts exactly these (plan decision 8): a blocked
 * company with no ERP decision behind it is the orphan to avoid. Prices, stock and
 * order statuses are not ledgered: after a reset the ERP re-mirrors them as they stand.
 *
 * Kept in App Builder State under one key so revert reads one document. Entries record
 * the value BEFORE the first ERP write; later writes to the same field keep that first
 * "before", so revert lands on what Commerce had before the ERP ever touched it.
 */
import stateLib from "@adobe/aio-lib-state";

const KEY = "erp-company-ledger";
const TTL_SECONDS = 365 * 24 * 60 * 60;

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetLedgerClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

/** @returns {Promise<object[]>} entries `{ companyId, field, before, after, at }` */
export async function readLedger() {
  const res = await (await state()).get(KEY);
  if (!res?.value) {
    return [];
  }
  try {
    return JSON.parse(res.value);
  } catch {
    return [];
  }
}

async function writeLedger(entries) {
  await (await state()).put(KEY, JSON.stringify(entries), { ttl: TTL_SECONDS });
}

/**
 * Record a company write. The first entry for a (company, field) pair keeps its
 * `before`; later ones only move `after`.
 */
export async function recordCompanyWrite({
  companyId,
  field,
  before,
  after,
  extra = {},
}) {
  const entries = await readLedger();
  const existing = entries.find(
    (e) => e.companyId === String(companyId) && e.field === field,
  );
  if (existing) {
    existing.after = after;
    existing.at = new Date().toISOString();
  } else {
    entries.push({
      after,
      at: new Date().toISOString(),
      before,
      companyId: String(companyId),
      field,
      ...extra,
    });
  }
  await writeLedger(entries);
  return entries;
}

/** Empty the ledger (after a successful revert). */
export async function clearLedger() {
  await (await state()).delete(KEY);
}

/**
 * Revert every ledgered write through the given writers, then clear the ledger.
 * @param {object} writers `{ creditLimit(companyId, creditId, before), status(companyId, before) }`
 * @returns {Promise<{ reverted: number, failed: {companyId, field, error}[] }>}
 */
export async function revertLedger(writers) {
  const entries = await readLedger();
  const failed = [];
  let reverted = 0;
  for (const entry of entries) {
    try {
      if (entry.field === "creditLimit") {
        // biome-ignore lint/performance/noAwaitInLoops: one write per entry, in order
        await writers.creditLimit(
          entry.companyId,
          entry.creditId,
          entry.before,
        );
      } else if (entry.field === "status") {
        await writers.status(entry.companyId, entry.before);
      }
      reverted += 1;
    } catch (error) {
      failed.push({
        companyId: entry.companyId,
        error: error.message,
        field: entry.field,
      });
    }
  }
  if (failed.length === 0) {
    await clearLedger();
  } else {
    await writeLedger(
      entries.filter((e) =>
        failed.some((f) => f.companyId === e.companyId && f.field === e.field),
      ),
    );
  }
  return { failed, reverted };
}
