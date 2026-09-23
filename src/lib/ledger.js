/*
 * The ledger of what this integration changed ON COMMERCE: the credit limits and blocks
 * the ERP decided on companies, and the prices and stock it decided on products.
 *
 * Commerce is the permanent system in a demo and the ERP is transient (owner,
 * 2026-09-23), so anything the ERP writes into Commerce that Commerce can undo must be
 * put back when the integration is removed. Companies were ledgered from the start;
 * prices and stock were not, and a demo that showed ERP-driven pricing left those prices
 * in the store after the integration was gone.
 *
 * What is NOT ledgered is what Commerce itself cannot undo: an order's number, notes,
 * shipments, invoices and cancellations. Those are the documented exception — the ERP
 * number is cleared by `detach`, and the rest stay.
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

/**
 * @returns {Promise<object[]>} entries `{ kind, id, field, before, after, at }` — plus
 *   `creditId` on a company credit entry and `source` on a stock entry. An entry saved
 *   before products were ledgered carries `companyId` and no `kind`; {@link asEntry}
 *   reads it as the company entry it is.
 */
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

/** An entry as today's shape, whatever shape it was saved in. */
function asEntry(entry) {
  return entry.kind
    ? entry
    : { ...entry, id: entry.companyId, kind: "company" };
}

/**
 * Record one write. The first entry for a (kind, id, field, source) keeps its `before`;
 * later ones only move `after`, so a revert lands on what Commerce had before the ERP
 * ever touched it.
 */
async function recordWrite({ kind, id, field, before, after, extra = {} }) {
  const entries = (await readLedger()).map(asEntry);
  const existing = entries.find(
    (e) =>
      e.kind === kind &&
      e.id === String(id) &&
      e.field === field &&
      e.source === extra.source,
  );
  if (existing) {
    existing.after = after;
    existing.at = new Date().toISOString();
  } else {
    entries.push({
      after,
      at: new Date().toISOString(),
      before,
      field,
      id: String(id),
      kind,
      ...extra,
    });
  }
  await writeLedger(entries);
  return entries;
}

/**
 * Record a company write: a credit limit or a block the ERP decided.
 *
 * @param {object} write `{ companyId, field, before, after, extra }`
 */
export async function recordCompanyWrite({
  companyId,
  field,
  before,
  after,
  extra = {},
}) {
  return recordWrite({
    after,
    before,
    extra,
    field,
    id: companyId,
    kind: "company",
  });
}

/**
 * Record a product write: a price, or the stock of ONE source (two sources of a SKU are
 * two entries, because they are two different values to put back).
 *
 * @param {object} write `{ sku, field, before, after, extra }` — `extra.source` for stock
 */
export async function recordProductWrite({
  sku,
  field,
  before,
  after,
  extra = {},
}) {
  return recordWrite({ after, before, extra, field, id: sku, kind: "product" });
}

/** Empty the ledger (after a successful revert). */
export async function clearLedger() {
  await (await state()).delete(KEY);
}

/**
 * Revert every ledgered write through the given writers, then clear the ledger.
 * Put ONE entry back, by what it is. An unknown field is not silently skipped: it would
 * leave a change in Commerce that nothing else will ever undo.
 */
function revertOne(entry, writers) {
  if (entry.kind === "product") {
    return entry.field === "stock"
      ? writers.stock(entry.id, entry.source, entry.before)
      : writers.price(entry.id, entry.before);
  }
  return entry.field === "creditLimit"
    ? writers.creditLimit(entry.id, entry.creditId, entry.before)
    : writers.status(entry.id, entry.before);
}

/**
 * Put back everything the ERP changed on Commerce, oldest first.
 *
@param {object} writers one per thing the ERP can change:
 *   `{ creditLimit(companyId, creditId, before), status(companyId, before),
 *      price(sku, before), stock(sku, source, before) }`
 * @returns {Promise<{ reverted: number, failed: {id, field, error}[] }>}
 */
export async function revertLedger(writers) {
  const entries = (await readLedger()).map(asEntry);
  const failed = [];
  let reverted = 0;
  for (const entry of entries) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one write per entry, in order
      await revertOne(entry, writers);
      reverted += 1;
    } catch (error) {
      failed.push({ error: error.message, field: entry.field, id: entry.id });
    }
  }
  if (failed.length === 0) {
    await clearLedger();
  } else {
    await writeLedger(
      entries.filter((e) =>
        failed.some((f) => f.id === e.id && f.field === e.field),
      ),
    );
  }
  return { failed, reverted };
}
