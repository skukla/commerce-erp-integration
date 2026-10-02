/*
 * What returns and credit memos share (returns-design.md §3): which ERP an ERP message is
 * from, and which line of the order a returned or credited line is.
 *
 * The ERP that SOLD a line takes it back: its part of the order (the parts record's
 * `itemIds`), never the product's owner today, which may have changed since. A configurable's
 * child line travels with its parent; an ERP's sales order names the parent (lib/order-sync.js
 * sends only lines without a parent), and Commerce's refund credits the parent and applies it
 * to the child (measured 2026-10-02). With one ERP there are no parts: every line is its.
 */
import { erpById } from "#lib/erps";
import { readOrderParts } from "#lib/order-parts";
import { inPart } from "#router/part-fulfilment";
import { findPart } from "#router/part-outcomes";

export const asList = (items) =>
  Array.isArray(items) ? items : Object.values(items ?? {});

/**
 * Each of an order's line ids → the line that carries it: a configurable child's parent, else
 * the line itself. A line id not on the order is not in the map.
 * @param {object} order the Commerce order
 * @returns {Map<number, number>}
 */
export function parentsOf(order) {
  return new Map(
    asList(order?.items).map((item) => [
      Number(item.item_id),
      Number(item.parent_item_id ?? item.item_id),
    ]),
  );
}

/**
 * The quantities to move each of a return's items by, from quantities by order line: an item
 * moves by its line's (or its line's parent's) quantity.
 * @param {Map<number, number>} qtyByLine order line id (the parent's) → quantity
 * @param {Map<number, number>} parents the order's lines (parentsOf)
 * @returns {(rma: object) => Map<number, number>} return item entity id → quantity
 */
export function movesByLine(qtyByLine, parents) {
  return (rma) => {
    const moves = new Map();
    for (const item of asList(rma.items)) {
      const id = Number(item.order_item_id);
      const line = parents.get(id) ?? id;
      if (qtyByLine.has(line)) {
        moves.set(Number(item.entity_id), qtyByLine.get(line));
      }
    }
    return moves;
  };
}

/**
 * The return items some ERP took (every piece's, sent or not); for a return this integration
 * never split, all of its items.
 * @param {{ pieces: object }} record the return's record (lib/order-returns.js)
 * @returns {(rma: object) => Set<number>}
 */
export function routedItemsOf(record) {
  const pieces = Object.values(record?.pieces ?? {});
  return (rma) =>
    new Set(
      pieces.length > 0
        ? pieces.flatMap((p) => (p.items ?? []).map((i) => i.returnItemId))
        : asList(rma.items).map((item) => Number(item.entity_id)),
    );
}

/** Whether a line (or the parent it travels with) is in a part. */
export function lineInPart(part, itemId, parentId, sku) {
  return inPart(part, itemId, sku) || inPart(part, parentId, sku);
}

/**
 * The ERP an ERP message about an order is from, and its part of the order.
 * @param {import("#adapters/contract").ErpEntry[]} erps the ERP list
 * @param {{ incrementId: string, erpId?: string, erpNumber?: string }} data the message
 * @returns {Promise<{ matched: true, erp: object, part: object|null } | { matched: false, reason: string }>}
 *   with one ERP, that ERP and no part
 */
export async function senderOf(erps, data) {
  if (erps.length <= 1) {
    return { erp: erps[0], matched: true, part: null };
  }
  const record = await readOrderParts(data.incrementId);
  if (Object.keys(record.parts).length === 0) {
    return {
      matched: false,
      reason: `order ${data.incrementId} was not routed`,
    };
  }
  const erpId = findPart(record, data);
  const erp = erpId ? erpById(erps, erpId) : null;
  if (!erp) {
    return {
      matched: false,
      reason: `order ${data.incrementId}: no part for ERP ${data.erpId ?? "(unnamed)"} sales order ${data.erpNumber}`,
    };
  }
  return { erp, matched: true, part: record.parts[erpId] };
}
