/*
 * An ERP's goods are back (returns-design.md §3.1 step 6, slice F): the ERP posted the receipt
 * of its return order and raised be-observer.rma_status_update (contract version 13). The
 * return in Commerce gets a comment naming the ERP and its return order, the ERP's piece is
 * recorded received (lib/order-returns.js), and its items are received in Commerce for the
 * quantities the ERP received (router/return-statuses.js; live test R-T2 answered yes on
 * 2026-10-02), which makes the return received once every ERP's goods are back.
 *
 * The ERP is the piece the event names (its ERP id, else its return order number), else the
 * ERP of the order's part (router/return-items.js senderOf); with one ERP, that ERP. Written
 * under the order's lock (lib/order-parts.js lockOrder); a redelivered event comments nothing
 * more and writes nothing more, because nothing moves back.
 */
import { erpById, loadErps } from "#lib/erps";
import { lockOrder, unlockOrder } from "#lib/order-parts";
import { readOrderReturn, writeOrderReturn } from "#lib/order-returns";
import {
  asList,
  movesByLine,
  parentsOf,
  routedItemsOf,
  senderOf,
} from "#router/return-items";
import { moveReturnItems } from "#router/return-statuses";
import {
  addReturnComment,
  getOrder,
} from "#src/order/commerce-order-api-client";

/** A piece in one of these already had its goods back. */
const BACK = Object.freeze(["received", "credited"]);

/** The ERP id of the piece the event names, or null. */
function namedPiece(record, data) {
  if (data.erpId && record.pieces[data.erpId]) {
    return data.erpId;
  }
  const byNumber = Object.entries(record.pieces).filter(
    ([, piece]) =>
      data.returnNumber && piece.returnNumber === String(data.returnNumber),
  );
  return byNumber.length === 1 ? byNumber[0][0] : null;
}

/** Which ERP sent the event, with its name; or why it cannot be told. */
async function receiverOf(erps, record, data) {
  const id = namedPiece(record, data);
  if (id) {
    return {
      id,
      matched: true,
      name: erpById(erps, id)?.name ?? record.pieces[id].erpName ?? id,
    };
  }
  const sender = await senderOf(erps, data);
  return sender.matched
    ? { id: sender.erp.id, matched: true, name: sender.erp.name }
    : sender;
}

/** Under the order's lock: note the piece received, comment once, receive the items. */
async function receiveUnderLock(params, data, erp, deps) {
  const returnId = Number(data.commerceReturnId);
  const record = await readOrderReturn(returnId);
  const piece = record.pieces[erp.id];
  const fresh = !BACK.includes(piece?.status);
  const words = `Goods received by ${erp.name} (return order ${data.returnNumber})`;
  if (piece && fresh) {
    record.pieces[erp.id] = {
      ...piece,
      receivedAt: new Date().toISOString(),
      status: "received",
    };
    await writeOrderReturn(returnId, record);
  }
  if (fresh) {
    await (deps.addReturnComment ?? addReturnComment)(params, returnId, words);
  }
  const order = await (deps.getOrder ?? getOrder)(params, Number(data.orderId));
  const parents = parentsOf(order);
  const qtyByLine = new Map();
  for (const line of asList(data.items)) {
    const id = Number(line.orderItemId);
    const parent = parents.get(id) ?? id;
    qtyByLine.set(parent, (qtyByLine.get(parent) ?? 0) + Number(line.qty));
  }
  await moveReturnItems(params, returnId, {
    deps,
    moves: movesByLine(qtyByLine, parents),
    routed: routedItemsOf(record),
    stage: "received",
  });
  return { matched: true, message: fresh ? words : `${words}: already noted` };
}

/**
 * An ERP received the goods of its return order.
 * @param {object} params action params
 * @param {object} data the ERP's event value (contract v13 rma_status_update)
 * @param {object} [deps] `{ erps, getOrder, getReturn, updateReturn, addReturnComment,
 *   attempts, wait }` (test seam)
 * @returns {Promise<{ matched: false, reason: string } | { busy: true, reason: string } |
 *   { matched: true, message: string }>}
 */
export async function returnReceivedFromErp(params, data, deps = {}) {
  const returnId = Number(data?.commerceReturnId);
  if (!(data?.commerceReturnId && Number.isFinite(returnId))) {
    return { matched: false, reason: "the event names no Commerce return" };
  }
  const erps = deps.erps ?? (await loadErps(params));
  const erp = await receiverOf(erps, await readOrderReturn(returnId), data);
  if (!erp.matched) {
    return erp;
  }
  const token = await lockOrder(data.incrementId, {
    attempts: deps.attempts,
    wait: deps.wait,
  });
  if (!token) {
    return {
      busy: true,
      reason: `order ${data.incrementId}: another write to the order is running; try again`,
    };
  }
  try {
    return await receiveUnderLock(params, data, erp, deps);
  } finally {
    await unlockOrder(data.incrementId, token);
  }
}
