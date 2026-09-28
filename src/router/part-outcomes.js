/*
 * An ERP's inbound message, matched to its part (design v1 §3.3). Every order message the
 * ERP sends names the Commerce order (`incrementId`) and its own sales order (`erpNumber`),
 * and may name the ERP (`erpId`). The part is the named ERP's, else the one part holding
 * that ERP number; two parts sharing a number with no ERP named match neither (two ERPs can
 * number alike). The ERP's adapter reads the message into the part's outcome.
 *
 * With one ERP there are no parts: nothing is read or recorded, and the handlers act on the
 * whole order exactly as before routing existed.
 */
import { adapterFor, erpById, listErps } from "#lib/erps";
import { readOrderParts, writeOrderParts } from "#lib/order-parts";
import { applyCombinedStatus } from "#router/combined-status";
import { addComment } from "#src/order/commerce-order-api-client";

/**
 * @param {{ parts: object }} record an order's parts
 * @param {{ erpId?: string, erpNumber?: string }} match what the message names
 * @returns {string|null} the ERP id of the part, or null
 */
export function findPart(record, { erpId, erpNumber }) {
  const parts = record?.parts ?? {};
  if (erpId) {
    return parts[erpId] ? erpId : null;
  }
  const holders = Object.entries(parts)
    .filter(([, part]) => erpNumber && part.erpNumber === String(erpNumber))
    .map(([id]) => id);
  return holders.length === 1 ? holders[0] : null;
}

/**
 * Record one inbound ERP message on its part.
 * @param {object} params action params
 * @param {"hold"|"cancel"|"invoice"|"shipment"|"order-status"} type the message's kind
 * @param {object} data the message's data
 * @param {object[]} [erps] the ERP list
 * @returns {Promise<null | { matched: false, reason: string } | { matched: true, erp: object, part: object, record: object, outcome: object }>}
 *   null with one ERP (the caller acts on the whole order)
 */
export async function recordPartMessage(
  params,
  type,
  data,
  erps = listErps(params),
) {
  if (erps.length <= 1) {
    return null;
  }
  const incrementId = data?.incrementId;
  const record = await readOrderParts(incrementId);
  if (Object.keys(record.parts).length === 0) {
    return { matched: false, reason: `order ${incrementId} was not routed` };
  }
  const id = findPart(record, data);
  const erp = id ? erpById(erps, id) : null;
  if (!erp) {
    return {
      matched: false,
      reason: `order ${incrementId}: no part for ERP ${data.erpId ?? "(unnamed)"} sales order ${data.erpNumber}`,
    };
  }
  const outcome = adapterFor(erp).readOutcome({ data, type });
  if (!outcome) {
    return { matched: false, reason: `a ${type} message is not about a part` };
  }
  record.parts[id] = {
    ...record.parts[id],
    ...(outcome.erpNumber ? { erpNumber: outcome.erpNumber } : {}),
    message: outcome.message,
    status: outcome.outcome,
  };
  await writeOrderParts(incrementId, record);
  return { erp, matched: true, outcome, part: record.parts[id], record };
}

/** What the router did to the order, in words for its history. */
const ACTION_WORDS = Object.freeze({
  hold: "Order put On Hold",
  none: "",
  release: "Order taken off hold",
});

/**
 * Record an inbound ERP message on its part, note it in the order's history under the ERP's
 * name, and write the combined status. The single entry point the inbound handlers use.
 * @param {object} params action params
 * @param {string} type the message's kind (see recordPartMessage)
 * @param {object} data the message's data
 * @param {number} orderId the Commerce order id
 * @param {object} [deps] `{ erps, addComment, applyCombinedStatus }` (test seam)
 * @returns {Promise<null | { matched: false, reason: string } | { matched: true, message: string }>}
 *   null with one ERP: the caller acts on the whole order as before
 */
export async function handlePartMessage(
  params,
  type,
  data,
  orderId,
  deps = {},
) {
  const result = await recordPartMessage(params, type, data, deps.erps);
  if (!result?.matched) {
    return result;
  }
  const comment = deps.addComment ?? addComment;
  const apply = deps.applyCombinedStatus ?? applyCombinedStatus;
  const decision = await apply(params, orderId, result.record);
  const action = ACTION_WORDS[decision.action];
  const message = `${result.erp.name}: ${result.outcome.message}${action ? ` ${action}: ${decision.reason}.` : ""}`;
  await comment(params, orderId, {
    statusHistory: {
      comment: message,
      is_customer_notified: 0,
      is_visible_on_front: 0,
    },
  });
  return { matched: true, message };
}
