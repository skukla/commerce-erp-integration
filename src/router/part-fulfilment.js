/*
 * Shipments and invoices per part (design v1 §3.3, slice B4). With several ERPs each ERP
 * invoices and ships only its own lines of an order:
 *
 * - an ERP's invoice becomes a PARTIAL Commerce invoice of that part's lines, never the whole
 *   order (which would bill the other ERPs' lines);
 * - an ERP's shipment carries only that part's lines, and its lines are invoiced first when
 *   they are not yet (Commerce ships only what is invoiced);
 * - partial invoices on one order are created one at a time, under the order's lock
 *   (lib/order-parts.js lockOrder); a lock that stays taken answers busy, so the event is
 *   delivered again rather than lost;
 * - a shipment or invoice made in Commerce tells each ERP only the lines of its own part.
 *
 * The part record keeps what each line has had invoiced and shipped, so a redelivered message
 * invoices nothing twice. With one ERP every function answers null and the handlers act on the
 * whole order exactly as before.
 */
import { paramsForErp } from "#adapters/contract";
import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";
import { erp as erpClient } from "#lib/erp";
import { erpById, loadErps } from "#lib/erps";
import {
  lockOrder,
  readOrderParts,
  unlockOrder,
  writeOrderParts,
} from "#lib/order-parts";
import { findPart } from "#router/part-outcomes";
import {
  getOrder,
  invoiceOrderItems,
} from "#src/order/commerce-order-api-client";

const SERVER_UNAVAILABLE = 503;
const BAD_REQUEST = 400;
const TOO_MANY = 429;
const SERVER_ERROR = 500;

const asList = (items) =>
  Array.isArray(items) ? items : Object.values(items ?? {});

/** Whether a line (Commerce's `order_item_id`, or the ERP's sku) is this part's. */
export function inPart(part, itemId, sku) {
  if (Array.isArray(part.itemIds) && part.itemIds.length > 0) {
    return part.itemIds.includes(Number(itemId));
  }
  return Boolean(sku) && (part.skus ?? []).includes(sku);
}

/** The ERP list, and the part a message is about; null with one ERP. */
async function findSplitPart(params, data, deps) {
  const erps = deps.erps ?? (await loadErps(params));
  if (erps.length <= 1) {
    return null;
  }
  const record = await readOrderParts(data?.incrementId);
  if (Object.keys(record.parts).length === 0) {
    return {
      matched: false,
      reason: `order ${data?.incrementId} was not routed`,
    };
  }
  const erpId = findPart(record, data ?? {});
  if (!erpId) {
    return {
      matched: false,
      reason: `order ${data?.incrementId}: no part for ERP ${data?.erpId ?? "(unnamed)"} sales order ${data?.erpNumber}`,
    };
  }
  return { erpId, matched: true, part: record.parts[erpId] };
}

/** Invoice what of `items` this part has not had invoiced yet, under the order's lock. */
async function invoiceUnderLock(
  params,
  orderId,
  incrementId,
  erpId,
  items,
  deps,
) {
  const token = await lockOrder(incrementId, {
    attempts: deps.attempts,
    wait: deps.wait,
  });
  if (!token) {
    return {
      busy: true,
      reason: `order ${incrementId}: another invoice is being created; try again`,
    };
  }
  try {
    const record = await readOrderParts(incrementId);
    const part = record.parts[erpId];
    const invoiced = { ...(part.invoiced ?? {}) };
    const due = items
      .map((item) => ({
        order_item_id: Number(item.order_item_id),
        qty: Number(item.qty) - Number(invoiced[item.order_item_id] ?? 0),
      }))
      .filter((item) => item.qty > 0);
    if (due.length > 0) {
      await (deps.invoiceItems ?? invoiceOrderItems)(params, orderId, due);
      for (const item of due) {
        invoiced[item.order_item_id] =
          Number(invoiced[item.order_item_id] ?? 0) + item.qty;
      }
      record.parts[erpId] = { ...part, invoiced };
      await writeOrderParts(incrementId, record);
    }
    return { erpId, invoiced: due, matched: true };
  } finally {
    await unlockOrder(incrementId, token);
  }
}

/**
 * An ERP invoiced its part: a partial Commerce invoice of that part's lines.
 * @param {object} params action params
 * @param {number} orderId the Commerce order id
 * @param {object} data the ERP's message (`incrementId`, `erpNumber`, `erpId`, `items[{orderItemId, qty, sku}]`)
 * @param {object} [deps] `{ erps, invoiceItems, attempts, wait }` (test seam)
 * @returns {Promise<null | {matched: false, reason: string} | {busy: true, reason: string} | {matched: true, erpId: string, invoiced: object[]}>}
 *   null with one ERP (the handler invoices the whole order, as before)
 */
export async function invoicePart(params, orderId, data, deps = {}) {
  const found = await findSplitPart(params, data, deps);
  if (!found?.matched) {
    return found;
  }
  const items = asList(data.items)
    .filter((item) => inPart(found.part, item.orderItemId, item.sku))
    .map((item) => ({
      order_item_id: Number(item.orderItemId),
      qty: Number(item.qty),
    }));
  return invoiceUnderLock(
    params,
    orderId,
    data.incrementId,
    found.erpId,
    items,
    deps,
  );
}

/**
 * An ERP shipped its part: keep only that part's lines, and invoice any not invoiced yet.
 * @param {object} params action params
 * @param {number} orderId the Commerce order id
 * @param {object} data the ERP's message
 * @param {{ items?: Array<{order_item_id: number, qty: number}> }} shipment the Commerce shipment body
 * @param {object} [deps] `{ erps, invoiceItems, attempts, wait }` (test seam)
 * @returns {Promise<null | {matched: false, reason: string} | {busy: true, reason: string} | {matched: true, erpId: string, items: object[]}>}
 *   null with one ERP (the shipment is left as it was)
 */
export async function prepareShipment(
  params,
  orderId,
  data,
  shipment,
  deps = {},
) {
  const found = await findSplitPart(params, data, deps);
  if (!found?.matched) {
    return found;
  }
  const skuOf = new Map(
    asList(data.items).map((item) => [Number(item.orderItemId), item.sku]),
  );
  const own = (shipment?.items ?? []).filter((item) =>
    inPart(
      found.part,
      item.order_item_id,
      skuOf.get(Number(item.order_item_id)),
    ),
  );
  const invoiced = await invoiceUnderLock(
    params,
    orderId,
    data.incrementId,
    found.erpId,
    own,
    deps,
  );
  if ("busy" in invoiced) {
    return invoiced;
  }
  return { erpId: found.erpId, items: own, matched: true };
}

/** Note what a part has had shipped. */
export async function recordShipped(incrementId, erpId, items) {
  const record = await readOrderParts(incrementId);
  const part = record.parts[erpId];
  if (!part) {
    return;
  }
  const shipped = { ...(part.shipped ?? {}) };
  for (const item of items) {
    shipped[item.order_item_id] =
      Number(shipped[item.order_item_id] ?? 0) + Number(item.qty);
  }
  record.parts[erpId] = { ...part, shipped };
  await writeOrderParts(incrementId, record);
}

/** A 4xx answer other than "too many requests": the ERP refused the request itself. */
function refusedForGood(res) {
  const status = Number(res?.status);
  return (
    !res?.ok &&
    status >= BAD_REQUEST &&
    status < SERVER_ERROR &&
    status !== TOO_MANY
  );
}

/** Tell one ERP about its lines of a Commerce shipment or invoice. */
function tellErp(params, kind, doc, entry, part, lines, client) {
  const erpParams = paramsForErp(params, entry);
  if (kind === "shipment") {
    return client.fromCommerce.ship(erpParams, part.erpNumber, {
      commerceShipmentId: String(doc.entity_id),
      items: lines,
      origin: originOf(COMMERCE_EVENTS.shipmentSaved, params),
      sourceCode: doc.extension_attributes?.source_code ?? null,
    });
  }
  return client.fromCommerce.invoice(erpParams, part.erpNumber, {
    commerceInvoiceId:
      doc.entity_id === undefined || doc.entity_id === null
        ? null
        : String(doc.entity_id),
    origin: originOf(COMMERCE_EVENTS.invoiceSaved, params),
  });
}

/**
 * A shipment or invoice made in Commerce, on a split order: each ERP is told only its lines.
 * @param {object} params action params
 * @param {"shipment"|"invoice"} kind what Commerce made
 * @param {object} doc the Commerce shipment or invoice (`order_id`, `entity_id`, `items[]`)
 * @param {object} [deps] `{ erp, erps, getOrder }` (test seam)
 * @returns {Promise<null | {outcome: string, statusCode: number, message: string,
 *   erpIds: string[], orderRef: string}>} null with one ERP, or for an order that was never
 *   split (today's path handles it); `erpIds` are the ERPs told, `orderRef` the order
 */
export async function fulfilmentFromCommerce(params, kind, doc, deps = {}) {
  const erps = deps.erps ?? (await loadErps(params));
  if (erps.length <= 1) {
    return null;
  }
  const order = await (deps.getOrder ?? getOrder)(
    params,
    Number(doc?.order_id),
  );
  const record = order ? await readOrderParts(order.increment_id) : null;
  if (!record || Object.keys(record.parts).length === 0) {
    return null;
  }
  // A configurable's child line travels with its parent: the ERP's sales order holds the
  // parent only, and refuses a child it does not know (live on Justrite 2026-10-02).
  const children = new Set(
    asList(order.items)
      .filter((line) => line.parent_item_id)
      .map((line) => Number(line.item_id)),
  );
  const items = asList(doc.items)
    .filter((item) => item && item.order_item_id !== undefined)
    .filter((item) => !children.has(Number(item.order_item_id)))
    .map((item) => ({
      orderItemId: Number(item.order_item_id),
      qty: Number(item.qty),
    }));
  const client = deps.erp ?? erpClient;
  const told = [];
  for (const [erpId, part] of Object.entries(record.parts)) {
    const entry = erpById(erps, erpId);
    const lines = items.filter((item) => inPart(part, item.orderItemId));
    // An invoice without lines covers the whole order, so every part hears it.
    if (
      !(entry && part.erpNumber && (lines.length > 0 || items.length === 0))
    ) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, like the router
    const res = await tellErp(params, kind, doc, entry, part, lines, client);
    told.push({
      id: entry.id,
      name: entry.name,
      ok: Boolean(res?.ok),
      reason: res?.data?.errorMessage ?? null,
      refused: refusedForGood(res),
    });
  }
  const failed = told.filter((t) => !t.ok).map((t) => t.name);
  const label = `Commerce ${kind} ${doc.increment_id ?? doc.entity_id}`;
  // For the Admin page's Activity: the ERPs told, and the order, whose trace the row opens.
  const named = {
    erpIds: told.map((t) => t.id),
    orderRef: String(order.increment_id),
  };
  // Every ERP that failed refused the request itself (a 4xx): delivering it again changes
  // nothing, so the delivery ends and the reason shows on the Admin page's Activity. On
  // 2026-10-02 a refusal answered "again later" and was re-delivered for two hours.
  const unanswered = told.filter((t) => !t.ok);
  if (unanswered.length > 0 && unanswered.every((t) => t.refused)) {
    return {
      ...named,
      message: `${label}: ${unanswered.map((t) => `${t.name} refused it (${t.reason ?? "no reason given"})`).join("; ")}.`,
      outcome: "dropped",
      statusCode: BAD_REQUEST,
    };
  }
  if (failed.length > 0) {
    return {
      ...named,
      message: `${label}: ${failed.join(" and ")} did not take it; delivered again later.`,
      outcome: "held",
      statusCode: SERVER_UNAVAILABLE,
    };
  }
  return {
    ...named,
    message: `${label}: told ${told.map((t) => t.name).join(" and ") || "no ERP"} about its lines.`,
    outcome: told.length > 0 ? "sent" : "skipped",
    statusCode: 200,
  };
}
