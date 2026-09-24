/*
 * What Commerce's inventory looked like the last time this integration read it: one
 * quantity per SKU per source. The minute refresh compares the next read against it and
 * sends the ERP only what moved, so an SC editing a non-default source's quantity in
 * Commerce Admin sees it in the ERP within the minute — the one stock change no Commerce
 * event carries (the legacy stock-item event is the default source only; no MSI
 * source-item event exists, read in the events reference 2026-09-24).
 *
 * A quantity the ERP itself wrote into Commerce is noted here as it is written, so the
 * next refresh does not read it back as a Commerce change and echo it to the ERP.
 *
 * Kept in App Builder State under one key, like the ledger.
 */
import stateLib from "@adobe/aio-lib-state";

const KEY = "erp-stock-snapshot";
const TTL_SECONDS = 365 * 24 * 60 * 60;

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetSnapshotClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

/** The key one quantity is kept under. */
export const slot = (sku, source) => `${sku}|${source}`;

/**
 * @returns {Promise<Record<string, number>|null>} `{ "sku|source": quantity }`, or null
 *   when nothing has been read yet (the first refresh only seeds)
 */
export async function readSnapshot() {
  const res = await (await state()).get(KEY);
  if (!res?.value) {
    return null;
  }
  try {
    return JSON.parse(res.value);
  } catch {
    return null;
  }
}

export async function writeSnapshot(quantities) {
  await (await state()).put(KEY, JSON.stringify(quantities), {
    ttl: TTL_SECONDS,
  });
}

/**
 * The ERP wrote these quantities into Commerce: remember them so the next refresh does
 * not send them back. Nothing is noted before the first read has seeded the snapshot.
 * @param {Array<{ sku: string, source_code: string, quantity: number }>} sourceItems
 */
export async function noteWritten(sourceItems) {
  const current = await readSnapshot();
  if (!current) {
    return;
  }
  for (const item of sourceItems) {
    current[slot(item.sku, item.source_code)] = Number(item.quantity);
  }
  await writeSnapshot(current);
}
