/*
 * A Commerce return, sent to each ERP that sold its lines (returns-design.md r1 step 2, §3.1
 * steps 3 to 5; slice E). Commerce raises observer.rma_save_commit_after on every save of a
 * return; its payload shape is not captured yet, so only the return's id is read from it and
 * the return itself is read from Commerce (GET returns/{id}).
 *
 * - The items are split by the order's parts record: an item belongs to the part holding its
 *   order line, or that line's parent. One piece per ERP, sent as a return order referencing
 *   that ERP's own sales order (the part's erpNumber); a configurable's child line is named by
 *   its parent, the line the ERP's sales order holds. With one ERP the whole return goes to
 *   it, on the sales order the Commerce order carries (lib/commerce-changes.js mine).
 * - An item in no part is recorded as unrouted, commented once, and never sent or guessed.
 * - Each piece is recorded in order-returns-<return id> (lib/order-returns.js) with its status
 *   and the ERP's return order number. A piece already sent is never sent again, so a later
 *   save of the return (a status change, or this integration's own writes) sends nothing new.
 *   A piece its ERP could not take (down, 5xx) waits failed and the event is delivered again;
 *   one its ERP refused waits failed and refused for staff (design §3.3), not redelivered.
 *   The ERP is idempotent on commerceReturnId as well.
 * - Each ERP that accepts has its items authorized in Commerce (router/return-statuses.js).
 *
 * All of it runs under the order's lock (lib/order-parts.js lockOrder).
 */
import { paramsForErp } from "#adapters/contract";
import { mine } from "#lib/commerce-changes";
import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";
import { erp as erpClient } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { lockOrder, readOrderParts, unlockOrder } from "#lib/order-parts";
import { readOrderReturn, writeOrderReturn } from "#lib/order-returns";
import { settingsFor } from "#lib/settings";
import {
  asList,
  lineInPart,
  movesByLine,
  parentsOf,
  routedItemsOf,
} from "#router/return-items";
import { moveReturnItems } from "#router/return-statuses";
import {
  addReturnComment,
  getOrder,
  getReturn,
  returnReasonLabels,
} from "#src/order/commerce-order-api-client";

const OK = 200;
const BAD_REQUEST = 400;
const UNAVAILABLE = 503;
const TOO_MANY = 429;
/** A piece in one of these is never sent again. */
const DONE = Object.freeze(["sent", "received", "credited"]);

const answer = (outcome, statusCode, message) => ({
  message,
  outcome,
  statusCode,
});

/** Which ERP takes each return item: `{ byErp: Map<erpId, item[]>, unrouted: item[] }`. */
async function split(rma, order, erps, reasonLabels) {
  const parents = parentsOf(order);
  const skuOf = new Map(
    asList(order.items).map((i) => [Number(i.item_id), i.sku]),
  );
  const parts =
    erps.length > 1 ? (await readOrderParts(order.increment_id)).parts : null;
  const byErp = new Map();
  const unrouted = [];
  for (const item of asList(rma.items)) {
    const id = Number(item.order_item_id);
    const line = parents.get(id) ?? id;
    const erpId = parts
      ? Object.entries(parts).find(([, part]) =>
          lineInPart(part, id, line, skuOf.get(line)),
        )?.[0]
      : erps[0].id;
    const piece = {
      commerceItemId: line,
      orderItemId: id,
      qty: Number(item.qty_requested),
      // Words for the ERP: the label Commerce shows for the stored option value, or the value
      // itself when Commerce did not name it.
      reason:
        item.reason === undefined || item.reason === null
          ? null
          : (reasonLabels.get(String(item.reason)) ?? String(item.reason)),
      returnItemId: Number(item.entity_id),
    };
    if (erpId) {
      byErp.set(erpId, [...(byErp.get(erpId) ?? []), piece]);
    } else {
      unrouted.push(piece);
    }
  }
  return { byErp, parts, unrouted };
}

/** The ERP's sales order a piece goes against, or why there is none. */
async function salesOrderOf(erpParams, entry, order, parts, deps) {
  if (parts) {
    const number = parts[entry.id]?.erpNumber;
    return number
      ? { number }
      : { refused: true, why: "its part of the order has no sales order" };
  }
  const own = await mine(erpParams, order.ext_order_id, {
    erp: deps.erp ?? erpClient,
    settingsFor: deps.settingsFor ?? settingsFor,
  });
  if (own.answer) {
    return {
      refused: own.answer.statusCode !== UNAVAILABLE,
      why: own.answer.message,
    };
  }
  return { number: own.number };
}

/** The return order body (contract v13 returns.request): one line per sales order line. */
function returnOrder(params, rma, number, items) {
  const lines = new Map();
  for (const item of items) {
    const known = lines.get(item.commerceItemId);
    lines.set(item.commerceItemId, {
      commerceItemId: item.commerceItemId,
      qty: (known?.qty ?? 0) + item.qty,
      reason: known?.reason ?? item.reason,
    });
  }
  return {
    commerceReturnId: String(rma.entity_id),
    commerceReturnIncrementId: String(rma.increment_id),
    lines: [...lines.values()],
    orderNumber: number,
    origin: originOf(COMMERCE_EVENTS.returnSaved, params),
  };
}

async function post(erpParams, body, deps) {
  try {
    return await (deps.erp ?? erpClient).fromCommerce.sendReturn(
      erpParams,
      body,
    );
  } catch (error) {
    return { data: { errorMessage: error.message }, ok: false, status: 0 };
  }
}

/** Send one ERP its piece: the piece as recorded, and the comment for the return. */
async function sendPiece(params, rma, order, parts, entry, items, deps) {
  const base = { erpName: entry.name, items };
  // One ERP: the deployed one, reached and named as the single-ERP paths do
  // (lib/commerce-changes.js), so the order number's prefix reads the same as at write-back.
  const erpParams = parts ? paramsForErp(params, entry) : params;
  const target = await salesOrderOf(erpParams, entry, order, parts, deps);
  if (!target.number) {
    return {
      comment: `${entry.name} was not sent the return: ${target.why}`,
      piece: {
        ...base,
        message: target.why,
        status: "failed",
        ...(target.refused ? { refused: true } : {}),
      },
    };
  }
  const body = returnOrder(params, rma, target.number, items);
  const res = await post(erpParams, body, deps);
  if (res.ok) {
    const n = res.data?.number;
    return {
      comment: `Sent to ${entry.name} as return order ${n}`,
      piece: {
        ...base,
        orderNumber: target.number,
        returnNumber: n,
        status: "sent",
      },
    };
  }
  const why = res.data?.errorMessage || `the ERP answered ${res.status}`;
  const retry =
    res.status === 0 || res.status >= 500 || res.status === TOO_MANY;
  return {
    comment: retry ? null : `${entry.name} refused its return order: ${why}`,
    piece: {
      ...base,
      message: why,
      orderNumber: target.number,
      status: "failed",
      ...(retry ? {} : { refused: true }),
    },
  };
}

/** Send every piece not sent yet; record each as it goes. Answers the pieces tried. */
async function sendPieces(params, rma, order, erps, deps) {
  // Unreadable labels never stop a return: the stored values are sent instead.
  const reasonLabels = await (deps.reasonLabels ?? returnReasonLabels)(
    params,
  ).catch(() => new Map());
  const { byErp, parts, unrouted } = await split(
    rma,
    order,
    erps,
    reasonLabels,
  );
  const record = await readOrderReturn(rma.entity_id);
  const comment = deps.addReturnComment ?? addReturnComment;
  const firstUnrouted = unrouted.length > 0 && record.unrouted.length === 0;
  Object.assign(record, {
    orderId: Number(order.entity_id),
    orderIncrementId: String(order.increment_id),
    returnIncrementId: String(rma.increment_id),
    unrouted: unrouted.map((i) => i.returnItemId),
  });
  const tried = [];
  for (const entry of erps.filter((e) => byErp.has(e.id))) {
    const known = record.pieces[entry.id];
    if (known && (DONE.includes(known.status) || known.refused)) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, the record saved in order
    const sent = await sendPiece(
      params,
      rma,
      order,
      parts,
      entry,
      byErp.get(entry.id),
      deps,
    );
    record.pieces[entry.id] = sent.piece;
    await writeOrderReturn(rma.entity_id, record);
    if (sent.comment) {
      await comment(params, rma.entity_id, sent.comment);
    }
    tried.push({ entry, piece: sent.piece });
  }
  const lines = unrouted.map((i) => i.orderItemId).join(", ");
  if (firstUnrouted) {
    await comment(
      params,
      rma.entity_id,
      `Not sent to any ERP: order line ${lines} was sold through none`,
    );
  }
  await writeOrderReturn(rma.entity_id, record);
  // Said once, when first found: a later save of the return is not a new refusal.
  return { lines: firstUnrouted ? lines : "", record, tried };
}

/** Authorize, in Commerce, the items of every piece an ERP took. */
function authorize(params, rma, order, record, deps) {
  const qtyByLine = new Map();
  for (const piece of Object.values(record.pieces)) {
    if (DONE.includes(piece.status)) {
      for (const item of piece.items) {
        qtyByLine.set(
          item.commerceItemId,
          (qtyByLine.get(item.commerceItemId) ?? 0) + item.qty,
        );
      }
    }
  }
  if (qtyByLine.size === 0) {
    return false;
  }
  return moveReturnItems(params, rma.entity_id, {
    deps,
    moves: movesByLine(qtyByLine, parentsOf(order)),
    routed: routedItemsOf(record),
    stage: "authorized",
  });
}

function outcomeOf(label, tried, lines) {
  const notes = lines
    ? [`${label}: order line ${lines} was sold through no ERP; not sent.`]
    : [];
  const message = [
    ...tried.map(({ entry, piece }) =>
      piece.status === "sent"
        ? `${label}: sent to ${entry.name} as return order ${piece.returnNumber}.`
        : `${label}: not sent to ${entry.name} (${piece.message}).`,
    ),
    ...notes,
  ].join(" ");
  const pieces = tried.map((t) => t.piece);
  if (pieces.some((p) => p.status === "failed" && !p.refused)) {
    return answer("held", UNAVAILABLE, message);
  }
  if (pieces.some((p) => p.status === "sent")) {
    return answer("sent", OK, message);
  }
  if (pieces.length > 0 || notes.length > 0) {
    return answer("dropped", BAD_REQUEST, message);
  }
  return answer("skipped", OK, `${label}: every piece was already sent.`);
}

/**
 * A return saved in Commerce: send each ERP its piece, once.
 * @param {object} params action params (the delivered event's `id` becomes the origin's)
 * @param {number} returnId the return's entity id
 * @param {object} [deps] `{ erps, erp, getReturn, getOrder, updateReturn, addReturnComment,
 *   reasonLabels, settingsFor, attempts, wait }` (test seam)
 * @returns {Promise<{ outcome: string, statusCode: number, message: string, erpIds?: string[],
 *   orderRef?: string }>}
 */
export async function returnToErps(params, returnId, deps = {}) {
  const rma = await (deps.getReturn ?? getReturn)(params, returnId);
  if (asList(rma?.items).length === 0) {
    return answer(
      "held",
      UNAVAILABLE,
      `return ${returnId} is not readable with its items yet`,
    );
  }
  const order = await (deps.getOrder ?? getOrder)(params, Number(rma.order_id));
  const erps = deps.erps ?? (await loadErps(params));
  const label = `return ${rma.increment_id}`;
  const token = await lockOrder(order.increment_id, {
    attempts: deps.attempts,
    wait: deps.wait,
  });
  if (!token) {
    return answer(
      "held",
      UNAVAILABLE,
      `${label}: another write to order ${order.increment_id} is running; try again`,
    );
  }
  try {
    const { lines, record, tried } = await sendPieces(
      params,
      rma,
      order,
      erps,
      deps,
    );
    await authorize(params, rma, order, record, deps);
    return {
      ...outcomeOf(label, tried, lines),
      erpIds: tried.map((t) => t.entry.id),
      orderRef: String(order.increment_id),
    };
  } finally {
    await unlockOrder(order.increment_id, token);
  }
}
