/*
 * The routing entry point for a placed order (design v1 §2). It knows no ERP: it reads the ERP
 * list, forms each ERP's part of the order, and hands each part to that ERP's adapter.
 *
 * Phase B slice B0 is pass-through: with one ERP in the list, the part is the whole order.
 * Splitting lines by their owning ERP is slice B1.
 */
import { adapterFor, listErps } from "#lib/erps";

function linesOf(order) {
  const items = order?.items ?? [];
  return Array.isArray(items) ? items : Object.values(items);
}

/**
 * Route one placed order.
 * @param {object} params action params
 * @param {object} order the Commerce order the event carries
 * @param {object} deps the collaborators the adapters send with (lib/order-deps.js)
 * @param {import("#adapters/contract").ErpEntry[]} [erps] the ERP list
 * @returns {Promise<import("#adapters/contract").PartOutcome>}
 */
export function routeOrder(params, order, deps, erps = listErps(params)) {
  if (erps.length !== 1) {
    throw new Error(
      `Routing an order to ${erps.length} ERPs is not built yet (Phase B slice B1).`,
    );
  }
  const [erp] = erps;
  return adapterFor(erp).sendPart(
    params,
    { erp, lines: linesOf(order), order },
    deps,
  );
}
