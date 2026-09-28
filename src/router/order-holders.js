/*
 * Which ERPs hold one order, and the sales order number each gave it (AB-16h), for reading the
 * order back from them. With several ERPs a routed order's parts say it (lib/order-parts.js).
 * An order with no parts but an ERP number from before several ERPs existed is the first ERP's
 * (lib/erps.js eventErpId). When nothing says which ERP holds it, and the caller asks, every
 * listed ERP is searched by the order's reference: that question is about the whole integration.
 */
import { paramsForErp } from "#adapters/contract";
import { erpById, eventErpId } from "#lib/erps";
import { readOrderParts } from "#lib/order-parts";
import { splitExtOrderId } from "#lib/structure";

/**
 * @param {object} params action params
 * @param {import("#adapters/contract").ErpEntry[]} erps the ERP list (several)
 * @param {object} order `{ incrementId, extOrderId?, searchAll?, byReference?(erpParams) }`:
 *   `byReference` answers the number one ERP holds the order under, or undefined
 * @returns {Promise<Array<{ entry: object, number: string }>>} in list order
 */
export async function orderHolders(params, erps, order) {
  const { parts } = await readOrderParts(order.incrementId);
  const routed = erps
    .filter((entry) => parts[entry.id]?.erpNumber)
    .map((entry) => ({ entry, number: parts[entry.id].erpNumber }));
  if (routed.length > 0) {
    return routed;
  }
  const { number } = splitExtOrderId(order.extOrderId);
  const first = erpById(erps, eventErpId(erps));
  if (number && first) {
    return [{ entry: first, number }];
  }
  if (!(order.searchAll && order.byReference)) {
    return [];
  }
  return searchByReference(params, erps, order.byReference);
}

async function searchByReference(params, erps, byReference) {
  const found = [];
  for (const entry of erps) {
    // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, few ERPs
    const number = await byReference(paramsForErp(params, entry));
    if (number) {
      found.push({ entry, number });
    }
  }
  return found;
}
