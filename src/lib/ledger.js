/*
 * The ledger of what this integration changed ON COMMERCE: the credit limits and blocks
 * the ERP decided on companies, the prices and stock it decided on products, and the
 * contract prices it wrote into companies' shared catalogs (tier prices).
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
 *
 * Every entry names its ERP (AB-16c), so one ERP can be undone and the others left. A product
 * entry names the ERP whose value Commerce holds now (`erpId`, the latest writer); a company
 * entry lists every ERP that wrote it (`erpIds`), because a company's credit attributes and
 * credit limit are one value shared between the ERPs. An entry naming none is the first
 * ERP's (`erp`), the rule the key map uses.
 */
import stateLib from "@adobe/aio-lib-state";

import { SINGLE_ERP_ID } from "#lib/erps";

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

/** Stamp an entry with the ERP that wrote it: a product's latest writer, a company's every one. */
function stamp(entry, erpId) {
  if (erpId === undefined) {
    return;
  }
  if (entry.kind === "company") {
    entry.erpIds = [...new Set([...(entry.erpIds ?? []), erpId])];
  } else {
    entry.erpId = erpId;
  }
}

/**
 * Record one write. The first entry for a (kind, id, field, source) keeps its `before`;
 * later ones only move `after`, so a revert lands on what Commerce had before the ERP
 * ever touched it. The ERP is not part of that key: two ERPs writing one value are one
 * value to put back, and whole undo stays one revert per value.
 */
async function recordWrite({
  kind,
  id,
  field,
  before,
  after,
  erpId,
  extra = {},
}) {
  const entries = (await readLedger()).map(asEntry);
  let entry = entries.find(
    (e) =>
      e.kind === kind &&
      e.id === String(id) &&
      e.field === field &&
      e.source === extra.source,
  );
  if (entry) {
    entry.after = after;
    entry.at = new Date().toISOString();
  } else {
    entry = {
      after,
      at: new Date().toISOString(),
      before,
      field,
      id: String(id),
      kind,
      ...extra,
    };
    entries.push(entry);
  }
  stamp(entry, erpId);
  await writeLedger(entries);
  return entries;
}

/**
 * Record a company write: a credit limit or a block the ERP decided.
 *
 * @param {object} write `{ companyId, field, before, after, erpId, extra }`
 */
export function recordCompanyWrite({
  companyId,
  field,
  before,
  after,
  erpId,
  extra = {},
}) {
  return recordWrite({
    after,
    before,
    erpId,
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
 * @param {object} write `{ sku, field, before, after, erpId, extra }` — `extra.source` for stock
 */
export function recordProductWrite({
  sku,
  field,
  before,
  after,
  erpId,
  extra = {},
}) {
  return recordWrite({
    after,
    before,
    erpId,
    extra,
    field,
    id: sku,
    kind: "product",
  });
}

/** The row a tier price entry stands for: one per SKU, customer group, quantity, website. */
const sameTierRow = (a, b) =>
  a.kind === "tierPrice" &&
  a.id === String(b.sku ?? b.id) &&
  a.customerGroup === b.customerGroup &&
  Number(a.quantity) === Number(b.quantity) &&
  Number(a.websiteId) === Number(b.websiteId);

/**
 * Record a tier price the ERP wrote into a company's shared catalog (AB-26z). The row is
 * Commerce's; the entry also names who it was written for (`erpId`, `partnerId`,
 * `companyId`), so a later publish replaces only that ERP's rows for that customer. The
 * first entry for a row keeps its `before` (`null`: the row did not exist).
 *
 * @param {object} write `{ sku, customerGroup, quantity, websiteId, erpId, partnerId,
 *   companyId, before: null | { price, priceType }, after: { price, priceType } }`
 */
export async function recordTierPriceWrite({ sku, before, after, ...row }) {
  const entries = (await readLedger()).map(asEntry);
  const existing = entries.find((e) => sameTierRow(e, { ...row, sku }));
  if (existing) {
    Object.assign(existing, row, { after, at: new Date().toISOString() });
  } else {
    entries.push({
      ...row,
      after,
      at: new Date().toISOString(),
      before,
      field: "tierPrice",
      id: String(sku),
      kind: "tierPrice",
    });
  }
  await writeLedger(entries);
}

/**
 * The tier prices one ERP wrote, for one customer or for all of them.
 * @param {{ erpId: string, partnerId?: string }} who
 */
export async function tierPriceEntries({ erpId, partnerId }) {
  return (await readLedger())
    .map(asEntry)
    .filter(
      (e) =>
        e.kind === "tierPrice" &&
        e.erpId === erpId &&
        (partnerId === undefined || e.partnerId === partnerId),
    );
}

/** Drop one tier price's entry, once its row has been put back. */
export async function forgetTierPrice(entry) {
  const entries = (await readLedger()).map(asEntry);
  await writeLedger(entries.filter((e) => !sameTierRow(e, entry)));
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
  if (entry.kind === "tierPrice") {
    return writers.tierPrice(entry);
  }
  if (entry.kind === "product") {
    if (entry.field === "stock") {
      return writers.stock(entry.id, entry.source, entry.before);
    }
    return entry.field === "name"
      ? writers.name(entry.id, entry.before)
      : writers.price(entry.id, entry.before);
  }
  if (entry.field === "customAttributes") {
    return writers.customAttributes(entry.id, entry.before);
  }
  return entry.field === "creditLimit"
    ? writers.creditLimit(entry.id, entry.creditId, entry.before)
    : writers.status(entry.id, entry.before);
}

/** The ERPs an entry is for. An entry naming none is the first ERP's. */
export function erpsOfEntry(entry) {
  if (entry.erpIds?.length > 0) {
    return entry.erpIds;
  }
  return [entry.erpId ?? SINGLE_ERP_ID];
}

/**
 * A company's credit attributes and credit limit: one value the ERPs share, so undoing one
 * ERP rebuilds it from what the others hold instead of restoring `before`.
 */
export function isSharedCredit(entry) {
  return (
    entry.kind === "company" &&
    (entry.field === "customAttributes" || entry.field === "creditLimit")
  );
}

/** Which entries a revert puts back: every one, or one ERP's own (never the shared credit). */
function revertedBy(erpId) {
  return (entry) =>
    erpId === undefined ||
    (!isSharedCredit(entry) && erpsOfEntry(entry).includes(erpId));
}

/** Write what is left, or empty the ledger when nothing is. */
function keep(entries) {
  return entries.length === 0 ? clearLedger() : writeLedger(entries);
}

/**
 * Put back everything the ERP changed on Commerce, oldest first. With an ERP id, only that
 * ERP's own entries; the others' stay in the ledger for their own undo.
 *
@param {object} writers one per thing the ERP can change:
 *   `{ creditLimit(companyId, creditId, before), status(companyId, before),
 *      customAttributes(companyId, before) (the per-ERP credit attributes),
 *      name(sku, before), price(sku, before), stock(sku, source, before),
 *      tierPrice(entry) (delete the row written, or put back the price it held) }`
 * @param {string} [erpId] the one ERP to undo; every ERP when absent
 * @returns {Promise<{ reverted: number, failed: {id, field, error}[] }>}
 */
export async function revertLedger(writers, erpId) {
  const entries = (await readLedger()).map(asEntry);
  const selected = revertedBy(erpId);
  const failed = [];
  // The entry itself, not every entry sharing its id and field: two tier prices of one SKU
  // (two groups, two quantities) are two rows, and only the failed one stays.
  const stays = new Set();
  let reverted = 0;
  for (const entry of entries.filter(selected)) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one write per entry, in order
      await revertOne(entry, writers);
      reverted += 1;
    } catch (error) {
      failed.push({ error: error.message, field: entry.field, id: entry.id });
      stays.add(entry);
    }
  }
  await keep(entries.filter((e) => !selected(e) || stays.has(e)));
  return { failed, reverted };
}

/**
 * One ERP's credit is off a company: drop it from the company's credit entries, or drop the
 * entries once the company is back to the limit it had before any ERP (`restored`).
 * @param {string} companyId the company
 * @param {string} erpId the ERP undone
 * @param {{ restored: boolean }} outcome
 */
export async function forgetCompanyErp(companyId, erpId, { restored }) {
  const entries = (await readLedger()).map(asEntry);
  const next = entries.flatMap((e) => {
    if (!isSharedCredit(e) || e.id !== String(companyId)) {
      return [e];
    }
    return restored
      ? []
      : [{ ...e, erpIds: erpsOfEntry(e).filter((id) => id !== erpId) }];
  });
  await keep(next);
}
