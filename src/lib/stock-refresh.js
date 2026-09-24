/*
 * The stock half of the minute refresh: read Commerce's source items, compare with the
 * last read (lib/stock-snapshot), send the ERP the SKUs that moved. Pure over the readers
 * and the snapshot it is handed, so it is tested without either system.
 */
import { slot } from "#lib/stock-snapshot";

/** How the refresh names itself in the ERP's journal (there is no Commerce event behind it). */
export const STOCK_REFRESH_ORIGIN = "inventory source items, read every minute";

/** `{ "sku|source": quantity }` from the store's stock. */
export function flatten(stockBySku) {
  const out = {};
  for (const [sku, rows] of stockBySku) {
    for (const row of rows) {
      out[slot(sku, row.code)] = row.quantity;
    }
  }
  return out;
}

/** The SKUs whose quantity in any source differs between two reads, or that gained or lost a source. */
export function changedSkus(previous, current) {
  const skus = new Set();
  for (const key of new Set([
    ...Object.keys(previous),
    ...Object.keys(current),
  ])) {
    if (previous[key] !== current[key]) {
      skus.add(key.slice(0, key.lastIndexOf("|")));
    }
  }
  return [...skus].sort();
}

/**
 * @param {object} readers `{ listStock, listSources? }`
 * @param {object} erp the ERP client (`importRecords`)
 * @param {object} snapshot `{ readSnapshot, writeSnapshot }`
 * @returns {Promise<{ seeded: boolean, changed: string[], sent: number }>}
 */
export async function refreshStock(params, readers, erp, snapshot) {
  const [stock, sourceNames] = await Promise.all([
    readers.listStock(params),
    readers.listSources ? readers.listSources(params) : new Map(),
  ]);
  const current = flatten(stock);
  const previous = await snapshot.readSnapshot();
  if (!previous) {
    // The first read only remembers: the mirror already gave the ERP this stock.
    await snapshot.writeSnapshot(current);
    return { changed: [], seeded: true, sent: 0 };
  }
  const changed = changedSkus(previous, current);
  if (changed.length === 0) {
    return { changed, seeded: false, sent: 0 };
  }
  const rows = changed
    .filter((sku) => stock.has(sku))
    .map((sku) => ({
      sku,
      warehouses: stock.get(sku).map((row) => ({
        code: row.code,
        name: sourceNames.get(row.code) || row.code,
        quantity: row.quantity,
      })),
    }));
  if (rows.length > 0) {
    const result = await erp.importRecords(params, {
      origin: { event: STOCK_REFRESH_ORIGIN },
      stock: rows,
    });
    if (!result.ok) {
      throw new Error(
        `ERP stock import answered ${result.status}: ${result.data?.errorMessage || "unknown error"}`,
      );
    }
  }
  await snapshot.writeSnapshot(current);
  return { changed, seeded: false, sent: rows.length };
}
