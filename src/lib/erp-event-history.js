/*
 * The ERP → Commerce half of the history (lib/history.js): each ERP event the integration
 * applied to Commerce, refused, or could not apply yet — under the event's own id, the
 * CloudEvent `id` that I/O Events, the ERP and Commerce share, so a redelivery updates its
 * own record and counts the tries.
 *
 * Recorded by wrapping each event handler: the handler's answer is what says how it ended
 * (success → applied; a 4xx → refused, which I/O Events does not deliver again; anything
 * else → failed, which it does). The event itself is kept with the record, so the Admin
 * screen's Retry can hand it to the same handler again.
 */
import { readRecord, updateRecord } from "#lib/history";

/** What each event changed, in the words a merchant reads, and the thing it is about. */
const DESCRIBE = {
  block: (d) => ({
    message: `company ${d.companyId}: ${d.blocked ? "blocked" : "unblocked"}`,
    ref: d.companyId,
  }),
  cancel: (d) => ({
    message: `order ${d.incrementId}: cancelled`,
    ref: d.incrementId,
  }),
  credit: (d) => ({
    message: `company ${d.companyId}: credit limit ${d.creditLimit}`,
    ref: d.companyId,
  }),
  invoice: (d) => ({
    message: `order ${d.incrementId}: invoiced`,
    ref: d.incrementId,
  }),
  "order-status": (d) => ({
    message: `order ${d.incrementId}: ${d.status}`,
    ref: d.incrementId,
  }),
  price: (d) => ({ message: `SKU ${d.sku}: price ${d.price}`, ref: d.sku }),
  shipment: (d) => ({
    message: `order ${d.incrementId}: shipped`,
    ref: d.incrementId,
  }),
  stock: (d) => ({
    message: `SKU ${d.sku} at ${d.source ?? "default"}: ${d.outOfStock ? "out of stock" : `${d.quantity} in stock`}`,
    ref: d.sku,
  }),
};

const CLIENT_ERROR = 400;
const SERVER_ERROR = 500;

/** How a handler's answer ended, and why when it did not work. */
function outcomeOf(response) {
  const status =
    response?.error?.statusCode ?? response?.statusCode ?? SERVER_ERROR;
  if (status < CLIENT_ERROR) {
    return { outcome: "applied" };
  }
  const reason =
    response?.error?.body?.message ?? `the handler answered ${status}`;
  return { outcome: status < SERVER_ERROR ? "refused" : "failed", reason };
}

async function record(kind, params, ended) {
  const data = params.data ?? {};
  const { message, ref } = (
    DESCRIBE[kind] ?? (() => ({ message: kind, ref: "" }))
  )(data);
  const eventId =
    typeof params.id === "string" && params.id ? params.id : `${Date.now()}`;
  await updateRecord(`erp.${eventId}`, (before, now) => ({
    attempts: (before?.attempts ?? 0) + 1,
    direction: "from-erp",
    event: { data, type: params.type },
    eventId,
    firstAt: before?.firstAt ?? now,
    kind,
    lastAt: now,
    message: ended.reason
      ? `${message} — not applied: ${ended.reason}`
      : message,
    outcome: ended.outcome,
    ref: String(ref ?? ""),
    ...(params.__retriedBy ? { retriedBy: params.__retriedBy } : {}),
  }));
}

/**
 * Wrap an ERP event handler so how each event ended is recorded.
 * @param {string} kind what the event changes: price, stock, order-status, shipment,
 *   invoice, cancel, credit, block
 * @param {(params: object) => Promise<object>} handler the action's own main
 * @returns {(params: object) => Promise<object>} the handler, recording as it answers
 */
export function recordingErpEvent(kind, handler) {
  return async (params) => {
    let response;
    try {
      response = await handler(params);
    } catch (error) {
      await record(kind, params, { outcome: "failed", reason: error.message });
      throw error;
    }
    await record(kind, params, outcomeOf(response));
    return response;
  };
}

/** The handler action for each kind, which the Admin screen's Retry invokes again. */
export const HANDLER_ACTIONS = {
  block: "company-backoffice/status-updated",
  cancel: "order-backoffice/cancelled",
  credit: "company-backoffice/credit-updated",
  invoice: "order-backoffice/invoice-created",
  "order-status": "order-backoffice/updated",
  price: "product-backoffice/updated",
  shipment: "order-backoffice/shipment-created",
  stock: "stock-backoffice/updated",
};

/**
 * The record of one ERP event, with the event itself, or undefined.
 * @param {string} eventId the CloudEvent id
 * @returns {Promise<object|undefined>}
 */
export function readErpEvent(eventId) {
  return readRecord(`erp.${eventId}`);
}
