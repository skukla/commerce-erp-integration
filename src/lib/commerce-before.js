/*
 * What Commerce holds RIGHT NOW, read before the ERP overwrites it.
 *
 * Commerce is the permanent system in a demo and the ERP is transient (owner,
 * 2026-09-23): everything the ERP writes into Commerce that Commerce can undo must be
 * put back when the integration is removed. Putting it back is only possible if the
 * previous value was read first, so these run before each write and their answers go
 * into the ledger (lib/ledger.js).
 *
 * A read that cannot answer returns NOT_READ. The ledger then records nothing, which is
 * the honest outcome: a value nobody knows must not be "restored" to a guess.
 */
import { commerceClient } from "#lib/commerce";

/** No answer — not a value, and not something to write back later. */
const NOT_READ = undefined;

/**
 * The price Commerce holds for a SKU.
 *
 * @param {object} params - the action params (Commerce credentials)
 * @param {string} sku - the SKU
 * @returns {Promise<number|undefined>} the price, or NOT_READ
 */
export async function priceOf(params, sku) {
  try {
    const client = await commerceClient(params);
    const product = await client
      .get(`products/${encodeURIComponent(sku)}`)
      .json();
    const price = Number(product?.price);
    return Number.isFinite(price) ? price : NOT_READ;
  } catch {
    return NOT_READ;
  }
}

/**
 * The quantity Commerce holds for a SKU at ONE source. Two sources of a SKU are two
 * different values to put back, so they are read — and recorded — separately.
 *
 * @param {object} params - the action params
 * @param {string} sku - the SKU
 * @param {string} source - the inventory source code
 * @returns {Promise<number|undefined>} the quantity, or NOT_READ
 */
export async function quantityOf(params, sku, source) {
  try {
    const client = await commerceClient(params);
    const answer = await client
      .get("inventory/source-items", {
        searchParams: {
          "searchCriteria[filter_groups][0][filters][0][field]": "sku",
          "searchCriteria[filter_groups][0][filters][0][value]": sku,
          "searchCriteria[filter_groups][1][filters][0][field]": "source_code",
          "searchCriteria[filter_groups][1][filters][0][value]": source,
        },
      })
      .json();
    const [row] = answer?.items ?? [];
    if (!row) {
      return NOT_READ;
    }
    const quantity = Number(row.quantity);
    return Number.isFinite(quantity) ? quantity : NOT_READ;
  } catch {
    return NOT_READ;
  }
}
