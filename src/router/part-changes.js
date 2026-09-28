/*
 * A cancel, hold or release made in Commerce on an order several ERPs share (AB-16h). A split
 * order carries no ERP number of its own (no one part writes ext_order_id), so the change goes to
 * every ERP holding an open part of it: a part with a sales order its ERP has not cancelled. Each
 * ERP is asked for its own sales order first (rule M2, lib/commerce-changes.js askErp) and told
 * at its own address, signed with its own credential (paramsForErp); what it is told is exactly
 * what one ERP is told (changeOnErpOrder), so a hold the ERP already has is not sent twice and
 * only a hold Commerce made is released.
 *
 * With one ERP, or an order that was never split, every function answers null and the
 * single-ERP change (lib/commerce-changes.js orderChangeFromCommerce) handles it as before.
 */
import { paramsForErp } from "#adapters/contract";
import { askErp, changeOnErpOrder } from "#lib/commerce-changes";
import { erp as erpClient } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { readOrderParts } from "#lib/order-parts";

const OK = 200;
const BAD_REQUEST = 400;
const UNAVAILABLE = 503;

/** The parts an ERP still holds a live sales order for, with their ERPs, in list order. */
function openParts(record, erps) {
  return erps
    .map((entry) => ({ entry, part: record.parts[entry.id] }))
    .filter(({ part }) => part?.erpNumber && part.status !== "cancelled");
}

/** One ERP's answer, named for the order's history. */
async function tellPart(params, order, { entry, part }, client) {
  const erpParams = paramsForErp(params, entry);
  const deps = { erp: client };
  const own = await askErp(erpParams, part.erpNumber, deps);
  const result =
    own.answer ?? (await changeOnErpOrder(erpParams, order, own, deps));
  return { ...result, message: `${entry.name}: ${result.message}` };
}

/** One answer for the delivery: wait for any ERP that could not answer, else end it. */
function combine(results) {
  const message = results.map((r) => r.message).join(" ");
  const has = (outcome) => results.some((r) => r.outcome === outcome);
  if (has("held")) {
    return { message, outcome: "held", statusCode: UNAVAILABLE };
  }
  if (has("dropped")) {
    return { message, outcome: "dropped", statusCode: BAD_REQUEST };
  }
  return { message, outcome: has("sent") ? "sent" : "skipped", statusCode: OK };
}

/**
 * A Commerce order save that is not a new order, on a split order.
 * @param {object} params action params
 * @param {object} order the event's value (state, increment_id, _isNew)
 * @param {object} [deps] `{ erp, erps }` (test seam)
 * @returns {Promise<null | { outcome: string, statusCode: number, message: string }>}
 *   null with one ERP, for a new order, or for an order with no open part
 */
export async function orderChangeToParts(params, order, deps = {}) {
  const erps = deps.erps ?? (await loadErps(params));
  if (erps.length <= 1 || order?._isNew === true || !order?.increment_id) {
    return null;
  }
  const open = openParts(await readOrderParts(order.increment_id), erps);
  if (open.length === 0) {
    return null;
  }
  const client = deps.erp ?? erpClient;
  const results = [];
  for (const part of open) {
    // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, like the router
    results.push(await tellPart(params, order, part, client));
  }
  return combine(results);
}
