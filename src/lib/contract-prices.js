/*
 * ERP contract prices into each company's shared catalog (AB-26z; the rule in the ERP
 * programme's "pricing and live checks": prices are synced ahead, and no ERP is asked on a
 * cart change). The cart, the listing and the product page then all price from Commerce.
 *
 * The ERP sends a customer's WHOLE set of prices in force (contract version 6: the
 * contract.changed event, and GET contracts/in-force), so applying it is a replace against
 * what this ERP wrote for that customer before, read from the write ledger: unchanged rows
 * stay, new or changed rows are written, and rows no longer in force are taken back (deleted,
 * or given back the price they held before the ERP first wrote them). A line becomes a tier
 * price for the customer group of the company's custom shared catalog (lib/commerce-tier-
 * prices.js): kind `price` a fixed price, kind `discount` a percentage, at the line's minimum
 * quantity. Only SKUs this ERP owns: each ERP writes and removes only its own rows.
 */
import { ALL_WEBSITES } from "#lib/commerce-tier-prices";
import { ownsSku as structureOwnsSku } from "#lib/structure";
import { ownersOf } from "#router/ownership";

const rowKey = (sku, group, quantity, website) =>
  `${sku}|${group}|${Number(quantity)}|${Number(website)}`;
const entryKey = (e) => rowKey(e.id, e.customerGroup, e.quantity, e.websiteId);
const commerceKey = (r) =>
  rowKey(r.sku, r.customer_group, r.quantity, r.website_id);
const sameValue = (a, b) =>
  Boolean(a && b) &&
  Number(a.price) === Number(b.price) &&
  a.priceType === b.priceType;

/**
 * Whether a SKU is this ERP's to price. One ERP owns everything; with several, a SKU is an
 * ERP's when the ownership rule gives it to that ERP alone (router/ownership.js).
 * @param {object} params action params
 * @param {object[]} erps the ERP list
 * @param {string} erpId the ERP
 * @param {object} readers `{ productAttributes, sourceCodesOf }`
 * @returns {(sku: string) => Promise<boolean>}
 */
export function ownedByErp(params, erps, erpId, readers) {
  if (erps.length === 1) {
    return async () => true;
  }
  const owns = (p, sku, settings) =>
    structureOwnsSku(p, sku, settings, readers);
  return async (sku) => {
    const owners = await ownersOf(params, sku, erps, owns);
    return owners.length === 1 && owners[0] === erpId;
  };
}

/** A contract line as the value of its tier price, or null when it carries none. */
function tierValueOf(line) {
  const discount = line.kind === "discount";
  const price = Number(discount ? line.percent : line.price);
  if (!(line.sku && Number.isFinite(price))) {
    return null;
  }
  return { price, priceType: discount ? "discount" : "fixed" };
}

/** The rows a customer's lines ask for, keyed; a later line for one row wins. */
async function wantedRows(lines, group, ownsSku) {
  const wanted = new Map();
  const notOwned = [];
  for (const line of lines) {
    const value = tierValueOf(line);
    if (!value) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: a few lines, each read once
    if (!(await ownsSku(line.sku))) {
      notOwned.push(line.sku);
      continue;
    }
    const quantity = Math.max(1, Number(line.minQty) || 1);
    wanted.set(rowKey(line.sku, group, quantity, ALL_WEBSITES), {
      after: value,
      quantity,
      sku: line.sku,
    });
  }
  return { notOwned, wanted };
}

/** Which company and customer group the lines are for, or why they are for none. */
async function targetOf(params, customer, deps) {
  const companyId = await deps.commerceCompanyOf(
    customer.partnerId,
    customer.erpId,
  );
  if (!companyId) {
    return {
      skip: `partner ${customer.partnerId} is paired with no Commerce company`,
    };
  }
  const group = await deps.tierPrices.sharedCatalogGroupOf(params, companyId);
  return group.skip ? group : { companyId, customerGroup: group.customerGroup };
}

/** What each new row held before the ERP wrote it: Commerce's row, or null. */
async function beforesOf(params, rows, deps) {
  const skus = [...new Set(rows.map((r) => r.sku))];
  const current = new Map(
    (await deps.tierPrices.tierPricesOf(params, skus)).map((r) => [
      commerceKey(r),
      { price: Number(r.price), priceType: r.price_type },
    ]),
  );
  return (row) => current.get(row.key) ?? null;
}

/** Write the rows, then ledger each one that landed (all of them, unless Commerce refused some). */
async function writeRows(params, rows, target, customer, deps) {
  const commerceRow = (r) => ({
    customer_group: target.customerGroup,
    price: r.after.price,
    price_type: r.after.priceType,
    quantity: r.quantity,
    sku: r.sku,
    website_id: ALL_WEBSITES,
  });
  let landed = rows;
  let refusal = null;
  try {
    await deps.tierPrices.writeTierPrices(params, rows.map(commerceRow));
  } catch (error) {
    refusal = error;
    const now = await beforesOf(params, rows, deps);
    landed = rows.filter((r) => sameValue(now(r), r.after));
  }
  for (const r of landed) {
    // biome-ignore lint/performance/noAwaitInLoops: one ledger document, written in turn
    await deps.ledger.recordTierPriceWrite({
      after: r.after,
      before: r.before,
      companyId: target.companyId,
      customerGroup: target.customerGroup,
      erpId: customer.erpId,
      partnerId: customer.partnerId,
      quantity: r.quantity,
      sku: r.sku,
      websiteId: ALL_WEBSITES,
    });
  }
  if (refusal) {
    throw refusal;
  }
}

/** Take back each held row the ERP no longer wants. */
async function removeRows(params, entries, deps) {
  for (const entry of entries) {
    // biome-ignore lint/performance/noAwaitInLoops: one row at a time, then its entry
    await deps.tierPrices.revertTierPrice(params, entry);
    await deps.ledger.forgetTierPrice(entry);
  }
}

/**
 * Apply one customer's prices in force from one ERP.
 * @param {object} params action params
 * @param {{ erpId: string, partnerId: string, lines: object[] }} customer
 * @param {object} deps `{ commerceCompanyOf, ownsSku(sku), ledger, tierPrices }`
 * @returns {Promise<{ written: number, removed: number, unchanged: number,
 *   skipped?: string, notOwned?: string[] }>}
 */
export async function applyCustomerPrices(params, customer, deps) {
  const held = await deps.ledger.tierPriceEntries({
    erpId: customer.erpId,
    partnerId: customer.partnerId,
  });
  const lines = Array.isArray(customer.lines) ? customer.lines : [];
  const target =
    lines.length > 0 ? await targetOf(params, customer, deps) : { skip: null };
  const { notOwned, wanted } = target.skip
    ? { notOwned: [], wanted: new Map() }
    : await wantedRows(lines, target.customerGroup, deps.ownsSku);
  const heldByKey = new Map(held.map((e) => [entryKey(e), e]));
  const rows = [...wanted].map(([key, r]) => ({ ...r, key }));
  const changed = rows.filter(
    (r) => !sameValue(heldByKey.get(r.key)?.after, r.after),
  );
  const fresh = changed.filter((r) => !heldByKey.has(r.key));
  const before = fresh.length > 0 ? await beforesOf(params, fresh, deps) : null;
  const toWrite = changed.map((r) => ({
    ...r,
    before: heldByKey.has(r.key) ? heldByKey.get(r.key).before : before(r),
  }));
  if (toWrite.length > 0) {
    await writeRows(params, toWrite, target, customer, deps);
  }
  const gone = held.filter((e) => !wanted.has(entryKey(e)));
  await removeRows(params, gone, deps);
  return {
    ...(notOwned.length > 0 ? { notOwned } : {}),
    removed: gone.length,
    ...(target.skip ? { skipped: target.skip } : {}),
    unchanged: rows.length - changed.length,
    written: toWrite.length,
  };
}

/**
 * Publish every customer's prices in force for one ERP (GET contracts/in-force's items). A
 * customer the ERP no longer lists has no prices in force: what the ERP wrote for it goes.
 * One customer failing does not stop the others.
 * @param {object} params action params
 * @param {{ id: string }} erp the ERP
 * @param {Array<{ partnerId: string, lines: object[] }>} items
 * @param {object} deps as {@link applyCustomerPrices}
 */
export async function publishErpPrices(params, erp, items, deps) {
  const total = {
    failed: [],
    removed: 0,
    skipped: [],
    unchanged: 0,
    written: 0,
  };
  const listed = new Set(items.map((i) => i.partnerId));
  const unlisted = [
    ...new Set(
      (await deps.ledger.tierPriceEntries({ erpId: erp.id }))
        .map((e) => e.partnerId)
        .filter((id) => !listed.has(id)),
    ),
  ].map((partnerId) => ({ lines: [], partnerId }));
  for (const item of [...items, ...unlisted]) {
    const customer = { ...item, erpId: erp.id };
    try {
      // biome-ignore lint/performance/noAwaitInLoops: customers in turn: one ledger document
      const result = await applyCustomerPrices(params, customer, deps);
      total.written += result.written;
      total.removed += result.removed;
      total.unchanged += result.unchanged;
      if (result.skipped) {
        total.skipped.push({
          erpId: erp.id,
          partnerId: item.partnerId,
          reason: result.skipped,
        });
      }
    } catch (error) {
      total.failed.push({
        erpId: erp.id,
        error: error.message,
        partnerId: item.partnerId,
      });
    }
  }
  return total;
}
