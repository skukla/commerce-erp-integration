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
