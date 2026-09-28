/*
 * Which ERP a call about a record goes to, as the params that reach it (AB-16h). Every call
 * to an ERP about one record (a product, an order, an ERP event) goes to the ERP that owns the
 * record, at its own address and signed with its own credential (adapters/contract.js
 * paramsForErp). With one ERP the call runs with the integration's own params, exactly as
 * before several ERPs existed.
 */
import { paramsForErp } from "#adapters/contract";
import { erpById, eventErpId } from "#lib/erps";
import { ownersOf } from "#router/ownership";

/**
 * The params for a call to one listed ERP.
 * @param {object} params action params
 * @param {import("#adapters/contract").ErpEntry[]} erps the ERP list
 * @param {string} id the ERP's id
 * @returns {object|null} with one ERP, `params` as given; with several, that ERP's own
 *   (paramsForErp); null for an ERP not in the list
 */
export function paramsOfErp(params, erps, id) {
  if (erps.length <= 1) {
    return params;
  }
  const entry = erpById(erps, id);
  return entry ? paramsForErp(params, entry) : null;
}

/**
 * The params to read back from the ERP an inbound event came from (lib/erps.js eventErpId: an
 * event naming no ERP is the first ERP's while it is listed).
 * @param {object} params action params
 * @param {import("#adapters/contract").ErpEntry[]} erps the ERP list
 * @param {string} [erpId] the id the event names
 * @returns {object|null} null when the event cannot be attributed to a listed ERP
 */
export function paramsOfEvent(params, erps, erpId) {
  const id = eventErpId(erps, erpId);
  return id ? paramsOfErp(params, erps, id) : null;
}

/** Why an event cannot be read back, for the 400 that ends its delivery. */
export const UNATTRIBUTED =
  "with several ERPs the event must name a listed ERP (erpId)";

/**
 * The one ERP that owns a SKU by the ownership rule routing uses (router/ownership.js).
 * @param {object} params action params
 * @param {string} sku the product
 * @param {import("#adapters/contract").ErpEntry[]} erps the ERP list
 * @param {(params: object, sku: string, settings: object) => Promise<boolean>} ownsSku
 * @returns {Promise<import("#adapters/contract").ErpEntry|null>} null when no ERP or two own it
 */
export async function ownerOfSku(params, sku, erps, ownsSku) {
  const owners = await ownersOf(params, sku, erps, ownsSku);
  return owners.length === 1 ? erpById(erps, owners[0]) : null;
}

/**
 * For an inbound stock event (its value is a list of lines, so it names no ERP): the params
 * that reach the ERP holding each SKU. With several ERPs that is the product's owner, else the
 * event's ERP by eventErpId (the first ERP while it is listed).
 * @param {object} params action params
 * @param {import("#adapters/contract").ErpEntry[]} erps the ERP list
 * @param {(params: object, sku: string, settings: object) => Promise<boolean>} ownsSku
 * @returns {(sku: string) => Promise<object|null>}
 */
export function stockParamsOf(params, erps, ownsSku) {
  if (erps.length <= 1) {
    return async () => params;
  }
  const unowned = paramsOfEvent(params, erps);
  return async (sku) => {
    const owner = await ownerOfSku(params, sku, erps, ownsSku);
    return owner ? paramsForErp(params, owner) : unowned;
  };
}

/**
 * Where a change made in Commerce to a product goes: the ERP that owns it. With one ERP, that
 * ERP when its own ownership setting owns the SKU (rule M3), with the integration's params as
 * before; with several, the one ERP the routing ownership rule names, with its own params.
 * @param {object} params action params
 * @param {string} sku the product
 * @param {object} deps `{ erps, ownsSku(params, sku, settings), settingsFor(storeId) }`
 * @returns {Promise<{ params: object } | { skip: string }>} the params, or why no ERP hears it
 */
export async function ownerParamsOf(
  params,
  sku,
  { erps, ownsSku, settingsFor },
) {
  if (erps.length <= 1) {
    return (await ownsSku(params, sku, await settingsFor(null)))
      ? { params }
      : { skip: `${sku} is not this ERP's product` };
  }
  const owner = await ownerOfSku(params, sku, erps, ownsSku);
  return owner
    ? { params: paramsForErp(params, owner) }
    : { skip: `no one ERP owns ${sku}` };
}
