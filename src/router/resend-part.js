/*
 * Re-send one part of an order (design v1 §3.3, slice B7): staff press Re-send on a held or
 * failed part on the order's parts page (the order view's "ERP parts" button). Only that part
 * is sent again, through its ERP's adapter and with only its lines; then the combined status
 * is written again from the whole record (router/combined-status.js).
 *
 * Idempotent by order and part: a part already with its ERP is answered as done and never sent
 * twice, and a part still being sent is refused, so two presses never send twice. A part a
 * block holds waits while the ERP still blocks the company: the unblock sends it.
 *
 * With one ERP the whole order is its one part and is sent again as it came, the way the
 * Admin screen's Retry sends it.
 */
import { isBlocked } from "#lib/erp-blocks";
import { adapterFor, erpById } from "#lib/erps";
import {
  FINAL_OUTCOMES,
  partStatusOf,
  readOrderParts,
  writeOrderParts,
} from "#lib/order-parts";
import { applyCombinedStatus } from "#router/combined-status";
import { linesOf } from "#router/route-order";

const NOT_FOUND = 404;
const CONFLICT = 409;

/** The statuses staff may send again from. */
const RESENDABLE = Object.freeze(["held", "failed"]);

/** Why a part cannot be sent now, as the answer, or null when it can. */
async function refusal(record, part, entry, label) {
  if (!part) {
    return {
      message: `${label} has no part for ${entry.name}.`,
      outcome: "dropped",
      statusCode: NOT_FOUND,
    };
  }
  if (FINAL_OUTCOMES.includes(part.status)) {
    return {
      message: `${label}: ${entry.name}'s part is already with it; nothing was sent.`,
      outcome: "skipped",
      statusCode: 200,
    };
  }
  if (!RESENDABLE.includes(part.status)) {
    return {
      message: `${label}: ${entry.name}'s part is ${part.status}; only a held or failed part is sent again.`,
      outcome: "skipped",
      statusCode: CONFLICT,
    };
  }
  if (
    part.heldBy === "block" &&
    record.companyId &&
    (await isBlocked(record.companyId, entry.id))
  ) {
    return {
      message: `${label}: ${entry.name} still blocks this company; its part is sent when it lifts the block.`,
      outcome: "held",
      statusCode: CONFLICT,
    };
  }
  return null;
}

/** The part's lines on the order: by Commerce item id, else by SKU for an older record. */
function partLines(order, part) {
  const lines = linesOf(order);
  if ((part.itemIds ?? []).length > 0) {
    return lines.filter((l) => part.itemIds.includes(Number(l.item_id)));
  }
  const skus = new Set(part.skus ?? []);
  const parents = new Set(
    lines
      .filter((l) => !l.parent_item_id && skus.has(l.sku))
      .map((l) => l.item_id),
  );
  return lines.filter((l) => parents.has(l.parent_item_id ?? l.item_id));
}

/**
 * @param {object} params action params
 * @param {{ incrementId: string, erpId: string }} ask the order and the part's ERP
 * @param {object} deps the order send's collaborators (lib/order-deps.js), with `getOrder`,
 *   `loadErps` and, as a test seam, `applyCombinedStatus`
 * @returns {Promise<import("#adapters/contract").PartOutcome & { part?: object }>}
 */
export async function resendPart(params, { incrementId, erpId }, deps) {
  const label = `order ${incrementId}`;
  const erps = await deps.loadErps(params);
  const entry = erpById(erps, erpId);
  if (!entry) {
    return {
      message: `No ERP ${erpId} in the list.`,
      outcome: "dropped",
      statusCode: NOT_FOUND,
    };
  }
  const record = await readOrderParts(incrementId);
  const refused = await refusal(record, record.parts[erpId], entry, label);
  if (refused) {
    return refused;
  }
  const order = await deps.getOrder(params, incrementId);
  if (!order) {
    return {
      message: `Commerce has no order ${incrementId}.`,
      outcome: "dropped",
      statusCode: NOT_FOUND,
    };
  }
  const { heldBy: _heldBy, ...part } = record.parts[erpId];
  record.parts[erpId] = { ...part, status: "sending" };
  await writeOrderParts(incrementId, record);
  const shared = erps.length > 1;
  const outcome = await adapterFor(entry).sendPart(
    params,
    {
      erp: entry,
      lines: partLines(order, part),
      // An order sent again is new to the send (lib/order-sync.js), as the Retry sends it.
      order: { ...order, _isNew: true },
      ...(shared ? { shared } : {}),
    },
    deps,
  );
  const { refused: _refused, ...open } = part;
  record.parts[erpId] = {
    ...open,
    ...(outcome.erpNumber ? { erpNumber: outcome.erpNumber } : {}),
    message: outcome.message,
    ...partStatusOf(outcome),
  };
  await writeOrderParts(incrementId, record);
  if (order.entity_id !== undefined) {
    const apply = deps.applyCombinedStatus ?? applyCombinedStatus;
    await apply(params, order.entity_id, record);
  }
  return { ...outcome, part: record.parts[erpId] };
}
