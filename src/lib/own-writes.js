/*
 * The writes this integration made to a Commerce product for an ERP event, remembered for a
 * short while so the save event each write raises is not imported back into the ERP (AB-62).
 *
 * Measured on Justrite, 2026-10-02, from the ERP's journal: the ERP renamed a product and
 * Commerce followed; eleven seconds later Commerce's save event came back and was imported;
 * the ERP renamed the product back; and eight seconds after that a SECOND save event from the
 * first rename was imported, putting the first name back into the ERP. The handler for the
 * second rename then read the ERP's current product (lib/erp-current.js), found the first
 * name, and Commerce kept it. Both systems agreed, on the older value.
 *
 * Such a save is not a change made in Commerce, so the ERP has nothing to hear. The
 * integration knows its own writes because it makes them: each is recorded here before it is
 * sent, and the product save handler drops a save whose name and price equal a record's. A
 * save whose values differ is a change made in Commerce Admin and is imported as before.
 *
 * One State record per write, keyed by what was written, each with its own lifetime: Commerce
 * raises more than one save event per write and a first write's echo can arrive after a
 * second write, so every write inside the window has to stay known, and two handler runs for
 * one product must not overwrite each other's record (a list under one key would).
 *
 * The ledger (lib/ledger.js) also records these writes, but keeps one entry per field whose
 * `after` moves with each write, so it no longer knows the first of two writes: the one whose
 * echo did the damage.
 *
 * Stock needs no record of its own: Commerce raises no event for a quantity written through
 * REST (docs/commerce-api-inventory.md, settled 2026-09-27). The product save event is what
 * carried Commerce's stock back to the ERP, and a dropped echo carries nothing.
 *
 * The other direction (AB-26y step 5, the ERP's contract version 19): a change made in Commerce
 * that this integration sends the ERP — a shipment, an invoice, a cancel, a hold or its release
 * — comes back as the ERP's own event, because a real ERP raises its events for every change,
 * whoever made it. Until version 19 the ERP held those events back; no real ERP does. The change
 * is recorded here before it is sent (sentToErp) and the ingestion webhook drops the event that
 * matches it (isErpEcho). Unlike a Commerce save, the ERP raises ONE event per change, so a
 * record is used up by its echo, and two equal changes (two shipments of the same lines) are
 * two echoes. A change the ERP did not make (it refused, was away, or had it already: 200 for a
 * document it already held) leaves no record, so it cannot swallow a later event of the ERP's
 * own.
 */
import { createHash } from "node:crypto";

import stateLib from "@adobe/aio-lib-state";

/**
 * How long a write stays known. The echoes measured arrived 11 and 22 seconds after the
 * write; two minutes leaves room for a slow or repeated delivery.
 */
export const OWN_WRITE_TTL_SECONDS = 120;

const MS = 1000;

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetOwnWritesClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

/** Commerce's price arrives as text ("12.500000"); the ERP's is a number. */
const priceOf = (price) =>
  price === undefined || price === null ? null : Number(price);

/** A key in State's alphabet for any SKU and name: a hash of what was written. */
function keyOf(sku, name, price) {
  const written = JSON.stringify([String(sku), name ?? null, priceOf(price)]);
  return `own-write-product.${createHash("sha256").update(written).digest("hex")}`;
}

/**
 * Remember a product write about to be sent to Commerce. Recorded before the write, so the
 * save event cannot arrive first.
 *
 * @param {string} sku - the product written
 * @param {{ name?: string, price?: number }} written - the fields the write carries; a
 *   configurable parent carries no price (lib/erp-current.js)
 */
export async function noteProductWrite(sku, { name, price }) {
  if (name === undefined && price === undefined) {
    return;
  }
  await (await state()).put(
    keyOf(sku, name, price),
    JSON.stringify({ at: new Date().toISOString() }),
    { ttl: OWN_WRITE_TTL_SECONDS },
  );
}

/**
 * How long a change sent to an ERP stays known: the ERP delivers its event while it answers,
 * and retries an undelivered one every minute, ten times (its contract's delivery.maxAttempts),
 * so an echo can arrive up to ten minutes late. Fifteen leaves room for a slow retry.
 */
export const ERP_ECHO_TTL_SECONDS = 900;

/** The moves that make an ERP document: only a 201 says the ERP made one (contract v19). */
const MAKES_DOCUMENT = new Set(["invoice", "shipment"]);

/**
 * @typedef {object} ErpChange a change sent to one ERP, as its event will name it
 * @property {string} erpId the ERP's id (lib/erps eventErpId)
 * @property {string} salesOrder the ERP's sales order number
 * @property {"cancel"|"hold"|"release"|"shipment"|"invoice"} kind what the ERP is asked to do
 * @property {Array<{ customerLineReference: string|number, qty: number }>} [lines] a shipment's
 */

/** A key in State's alphabet for a change: a hash of the ERP, the document and the lines. */
function changeKey({ erpId, salesOrder, kind, lines }) {
  const named = (lines ?? [])
    .map((l) => `${String(l.customerLineReference)}:${Number(l.qty)}`)
    .sort();
  const written = JSON.stringify([
    String(erpId),
    String(salesOrder),
    kind,
    named,
  ]);
  return `own-write-erp.${createHash("sha256").update(written).digest("hex")}`;
}

/** How many changes under this key are still waiting for their echo. */
async function waiting(key) {
  const res = await (await state()).get(key);
  if (!res?.value) {
    return 0;
  }
  try {
    const { at, count } = JSON.parse(res.value);
    const fresh = Date.now() - Date.parse(at) < ERP_ECHO_TTL_SECONDS * MS;
    return fresh ? Number(count) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Set how many changes under this key wait for their echo; none deletes the record. */
async function setWaiting(key, count) {
  const client = await state();
  if (count <= 0) {
    await client.delete(key);
    return;
  }
  await client.put(
    key,
    JSON.stringify({ at: new Date().toISOString(), count }),
    { ttl: ERP_ECHO_TTL_SECONDS },
  );
}

/** Whether the ERP made the change: a document when it answers 201, a move when it answers ok. */
const madeIt = (kind, res) =>
  MAKES_DOCUMENT.has(kind) ? res?.status === 201 : Boolean(res?.ok);

/**
 * Send a change made in Commerce to an ERP, remembering it first so the ERP's event for it is
 * known as its echo. Forgotten again when the ERP did not make it.
 *
 * @param {ErpChange} change the change, as the ERP's event will name it
 * @param {() => Promise<{ ok: boolean, status: number }>} send the ERP call (lib/erp fromCommerce)
 * @returns {Promise<object>} what the ERP answered
 */
export async function sentToErp(change, send) {
  const key = changeKey(change);
  await setWaiting(key, (await waiting(key)) + 1);
  let res;
  try {
    res = await send();
  } finally {
    if (!madeIt(change.kind, res)) {
      await setWaiting(key, (await waiting(key)) - 1);
    }
  }
  return res;
}

/**
 * Whether an ERP event echoes a change this integration sent it; if so it is used up.
 * @param {ErpChange} change what the event names (translate.js erpChangeOf) and its ERP
 * @returns {Promise<boolean>}
 */
export async function isErpEcho(change) {
  const key = changeKey(change);
  const count = await waiting(key);
  if (count === 0) {
    return false;
  }
  await setWaiting(key, count - 1);
  return true;
}

/** Whether a record exists under this key and is still inside the window. */
async function live(key) {
  const res = await (await state()).get(key);
  if (!res?.value) {
    return false;
  }
  try {
    const age = Date.now() - Date.parse(JSON.parse(res.value).at);
    return age < OWN_WRITE_TTL_SECONDS * MS;
  } catch {
    return false;
  }
}

/**
 * Whether a Commerce product save carries exactly what this integration wrote in the last
 * two minutes: the save event of its own write, not a change made in Commerce.
 *
 * A save always carries a name and a price, a write may have carried only one of them, so
 * the save is also compared with a write of its name alone and of its price alone.
 *
 * @param {string} sku - the product saved
 * @param {{ name?: string, price?: number|string }} saved - the save event's name and price
 * @returns {Promise<boolean>}
 */
export async function isOwnProductWrite(sku, { name, price }) {
  const found = await Promise.all(
    [
      keyOf(sku, name, price),
      keyOf(sku, name, undefined),
      keyOf(sku, undefined, price),
    ].map(live),
  );
  return found.some(Boolean);
}
