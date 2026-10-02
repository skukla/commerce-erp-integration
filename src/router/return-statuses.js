/*
 * A Commerce return's statuses, moved as each ERP takes its lines (returns-design.md r1; live
 * test R-T2 answered yes on 2026-10-02: PUT returns/{id} sets item and return statuses):
 *
 * - an ERP accepts its return order: its items `authorized` for the quantity sent;
 * - its goods are back: `received` for the quantity received;
 * - it credits them: `approved` for the quantity credited.
 *
 * The return's own status follows its routed items (a line no ERP took never holds it back):
 * authorized once every routed item is, else partly; the same for received; processed and
 * closed once every routed item is approved. Nothing ever moves back: a late authorization
 * leaves a received item alone, so a redelivered event writes nothing.
 *
 * Measured 2026-10-02 (the trap): a PUT whose return lacks its increment_id gives the return a
 * NEW number. So the return is read first and written back whole, every item with every field
 * it had, only statuses and quantities changed. Its comments and tracks are left out: they are
 * written through their own routes, and sent back they could be saved again.
 *
 * Read live: `authorized`, `received`, `approved` on items; `authorized`, `received`,
 * `processed_closed` on the return. NOT read live: the two partial return statuses below.
 */
import { getReturn, updateReturn } from "#src/order/commerce-order-api-client";

/** The return statuses this module writes. */
export const RETURN_STATUS = Object.freeze({
  authorized: "authorized",
  closed: "processed_closed",
  // Not verified live: the codes for "Partially Authorized" and "Return Partially Received".
  // The second is Magento's Rma Source\Status STATE_RECEIVED_ON_ITEM as recalled, not read.
  partlyAuthorized: "partially_authorized",
  partlyReceived: "received_on_item",
  received: "received",
});

/** How far along an item is; a status not here (denied, rejected) is staff's and left alone. */
const ITEM_RANK = Object.freeze({
  approved: 3,
  authorized: 1,
  pending: 0,
  received: 2,
});

/** How far along a return is, so a write never moves it back. */
const RETURN_RANK = Object.freeze({
  authorized: 2,
  closed: 7,
  partially_authorized: 1,
  pending: 0,
  processed_closed: 6,
  received: 4,
  received_on_item: 3,
});

/** The item quantity each stage sets, and the earlier ones it fills when they are empty. */
const STAGE_QTY = Object.freeze({
  approved: ["qty_approved", ["qty_authorized", "qty_returned"]],
  authorized: ["qty_authorized", []],
  received: ["qty_returned", ["qty_authorized"]],
});

const asList = (items) =>
  Array.isArray(items) ? items : Object.values(items ?? {});

function movedItem(item, stage, qty) {
  const rank = ITEM_RANK[item.status ?? "pending"];
  if (rank === undefined || rank >= ITEM_RANK[stage]) {
    return item;
  }
  const [field, earlier] = STAGE_QTY[stage];
  const moved = { ...item, [field]: qty, status: stage };
  for (const before of earlier) {
    if (!Number(item[before])) {
      moved[before] = qty;
    }
  }
  return moved;
}

/** Every routed item at least this far along (a status staff set, such as denied, counts). */
function allAt(items, routed, rank) {
  return items
    .filter((item) => routed.has(Number(item.entity_id)))
    .every((item) => (ITEM_RANK[item.status ?? "pending"] ?? rank) >= rank);
}

function returnStatusFor(items, stage, routed, current) {
  if (stage === "approved") {
    return allAt(items, routed, ITEM_RANK.approved)
      ? RETURN_STATUS.closed
      : current;
  }
  const full =
    stage === "authorized" ? RETURN_STATUS.authorized : RETURN_STATUS.received;
  const partly =
    stage === "authorized"
      ? RETURN_STATUS.partlyAuthorized
      : RETURN_STATUS.partlyReceived;
  return allAt(items, routed, ITEM_RANK[stage]) ? full : partly;
}

/**
 * The return to write back after moving some of its items to a stage, or null when nothing
 * would change.
 * @param {object} rma the return, as GET returns/{id} answered it
 * @param {Map<number, number>} moves return item entity id → quantity
 * @param {"authorized"|"received"|"approved"} stage where the items move to
 * @param {Set<number>} routed the return item ids some ERP took
 * @returns {object|null}
 */
export function nextReturn(rma, moves, stage, routed) {
  const before = asList(rma.items);
  const items = before.map((item) =>
    moves.has(Number(item.entity_id))
      ? movedItem(item, stage, moves.get(Number(item.entity_id)))
      : item,
  );
  const wanted = returnStatusFor(items, stage, routed, rma.status);
  const status =
    (RETURN_RANK[wanted] ?? 0) > (RETURN_RANK[rma.status] ?? 0)
      ? wanted
      : rma.status;
  const changed =
    status !== rma.status || items.some((item, i) => item !== before[i]);
  if (!changed) {
    return null;
  }
  const { comments: _comments, tracks: _tracks, ...whole } = rma;
  return { ...whole, items, status };
}

/**
 * Move some of a return's items to a stage in Commerce: read the return, write it back whole.
 * Callers hold the order's lock (lib/order-parts.js lockOrder).
 * @param {object} params action params
 * @param {number} returnId the return's entity id
 * @param {{ moves: Map<number, number> | ((rma: object) => Map<number, number>), stage: string,
 *   routed: Set<number> | ((rma: object) => Set<number>),
 *   deps?: { getReturn?: Function, updateReturn?: Function } }} change `moves` and `routed`
 *   may be read off the return once it is read
 * @returns {Promise<boolean>} whether anything was written
 */
export async function moveReturnItems(params, returnId, change) {
  const deps = change.deps ?? {};
  const rma = await (deps.getReturn ?? getReturn)(params, returnId);
  const of = (value) => (typeof value === "function" ? value(rma) : value);
  const next = nextReturn(
    rma,
    of(change.moves),
    change.stage,
    of(change.routed),
  );
  if (!next) {
    return false;
  }
  await (deps.updateReturn ?? updateReturn)(params, returnId, next);
  return true;
}
