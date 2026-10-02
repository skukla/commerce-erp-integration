/*
 * An ERP's credit memo, made into a Commerce credit memo (returns-design.md §3.1 step 7, slice
 * D). The ERP decides how much it credits; Commerce gets one credit memo per ERP credit memo,
 * of only that ERP's lines:
 *
 * - every line must be the ERP's (its part of the order); a credit memo naming another ERP's
 *   line, or a line the order lacks, is refused whole, so money is never credited for a line
 *   the ERP did not sell;
 * - offline, shipping 0, nothing returned to stock (commerce-order-api-client.js
 *   refundOrderItems): the ERP owns stock;
 * - made under the order's lock (lib/order-parts.js lockOrder), the one partial invoices take,
 *   so two writes to one order's money never run at once; a lock that stays taken answers busy
 *   and the event is delivered again;
 * - keyed by the ERP's credit memo number in the order's applied credit memos
 *   (lib/order-returns.js), so a redelivered event credits nothing twice.
 *
 * A credit memo that names a return also writes to the return: a comment, its piece credited,
 * and that ERP's items approved (router/return-statuses.js), which closes the return once every
 * ERP has credited.
 */
import { loadErps } from "#lib/erps";
import { lockOrder, unlockOrder } from "#lib/order-parts";
import {
  readOrderCredits,
  readOrderReturn,
  writeOrderCredits,
  writeOrderReturn,
} from "#lib/order-returns";
import {
  asList,
  lineInPart,
  movesByLine,
  parentsOf,
  routedItemsOf,
  senderOf,
} from "#router/return-items";
import { moveReturnItems } from "#router/return-statuses";
import {
  addComment,
  addReturnComment,
  getOrder,
  refundOrderItems,
} from "#src/order/commerce-order-api-client";

/**
 * The credit memo's lines, by the order line that carries each, or why it is refused.
 * @returns {{ items: Array<{order_item_id: number, qty: number}> } | { reason: string }}
 */
function creditedLines(order, data, sender) {
  const parents = parentsOf(order);
  const byParent = new Map();
  const foreign = [];
  for (const line of asList(data.items)) {
    const id = Number(line.orderItemId);
    const parent = parents.get(id);
    if (parent === undefined) {
      return { reason: `the order has no line ${line.orderItemId}` };
    }
    if (sender.part && !lineInPart(sender.part, id, parent, line.sku)) {
      foreign.push(id);
      continue;
    }
    byParent.set(parent, (byParent.get(parent) ?? 0) + Number(line.qty));
  }
  if (foreign.length > 0) {
    const s = foreign.length > 1 ? "s" : "";
    return {
      reason: `line${s} ${foreign.join(", ")} ${s ? "are" : "is"} not ${sender.erp.name}'s`,
    };
  }
  const items = [...byParent]
    .filter(([, qty]) => qty > 0)
    .map(([order_item_id, qty]) => ({ order_item_id, qty }));
  return items.length > 0 ? { items } : { reason: "it credits no line" };
}

/** The return the credit memo names: its piece credited, a comment, and the items approved. */
async function creditReturn(params, data, credit, deps) {
  const returnId = Number(data.commerceReturnId);
  const record = await readOrderReturn(returnId);
  const piece = record.pieces[credit.erp.id];
  if (piece) {
    const memos = new Set(piece.creditMemos ?? []);
    memos.add(String(data.creditMemoNumber));
    record.pieces[credit.erp.id] = {
      ...piece,
      creditMemos: [...memos],
      status: "credited",
    };
    await writeOrderReturn(returnId, record);
  }
  if (credit.fresh) {
    await (deps.addReturnComment ?? addReturnComment)(
      params,
      returnId,
      `Credited by ${credit.erp.name} (credit memo ${data.creditMemoNumber})`,
    );
  }
  await moveReturnItems(params, returnId, {
    deps,
    moves: movesByLine(
      new Map(credit.items.map((i) => [i.order_item_id, i.qty])),
      credit.parents,
    ),
    routed: routedItemsOf(record),
    stage: "approved",
  });
}

/** Under the order's lock: credit once, note it, and write to the return. */
async function creditUnderLock(params, orderId, data, credit, deps) {
  const incrementId = String(data.incrementId);
  const credits = await readOrderCredits(incrementId);
  const key = `${credit.erp.id}/${data.creditMemoNumber}`;
  const fresh = !credits.applied[key];
  const words = `Credited in ${credit.erp.name} (credit memo ${data.creditMemoNumber})`;
  if (fresh) {
    const id = await (deps.refundOrderItems ?? refundOrderItems)(
      params,
      orderId,
      credit.items,
      words,
    );
    credits.applied[key] = {
      at: new Date().toISOString(),
      commerceCreditMemoId: String(id),
      items: credit.items,
      ...(data.returnNumber ? { returnNumber: data.returnNumber } : {}),
    };
    await writeOrderCredits(incrementId, credits);
    await (deps.addComment ?? addComment)(params, orderId, {
      statusHistory: {
        comment: words,
        is_customer_notified: 0,
        is_visible_on_front: 0,
      },
    });
  }
  if (data.commerceReturnId) {
    await creditReturn(params, data, { ...credit, fresh }, deps);
  }
  return fresh
    ? { erpId: credit.erp.id, matched: true, message: words }
    : {
        already: true,
        erpId: credit.erp.id,
        matched: true,
        message: `${words}: already credited`,
      };
}

/**
 * An ERP credited some lines: one Commerce credit memo of exactly those lines.
 * @param {object} params action params
 * @param {number} orderId the Commerce order id
 * @param {object} data the ERP's event value (contract v13 sales_order_creditmemo_create)
 * @param {object} [deps] `{ erps, getOrder, refundOrderItems, addComment, addReturnComment,
 *   getReturn, updateReturn, attempts, wait }` (test seam)
 * @returns {Promise<{ matched: false, reason: string } | { busy: true, reason: string } |
 *   { matched: true, erpId: string, message: string, already?: true }>}
 */
export async function creditMemoFromErp(params, orderId, data, deps = {}) {
  const label = `order ${data?.incrementId}`;
  if (!data?.creditMemoNumber) {
    return {
      matched: false,
      reason: `${label}: the credit memo has no number`,
    };
  }
  const erps = deps.erps ?? (await loadErps(params));
  const sender = await senderOf(erps, data);
  if (!sender.matched) {
    return sender;
  }
  const order = await (deps.getOrder ?? getOrder)(params, orderId);
  const lines = creditedLines(order, data, sender);
  if (lines.reason) {
    return {
      matched: false,
      reason: `${label}: ${lines.reason}; credit memo ${data.creditMemoNumber} not applied`,
    };
  }
  const token = await lockOrder(data.incrementId, {
    attempts: deps.attempts,
    wait: deps.wait,
  });
  if (!token) {
    return {
      busy: true,
      reason: `${label}: another write to the order is running; try again`,
    };
  }
  try {
    return await creditUnderLock(
      params,
      orderId,
      data,
      { erp: sender.erp, items: lines.items, parents: parentsOf(order) },
      deps,
    );
  } finally {
    await unlockOrder(data.incrementId, token);
  }
}
