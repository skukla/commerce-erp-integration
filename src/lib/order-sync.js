/*
 * A Commerce order into the ERP, from Commerce's order save event
 * (`observer.sales_order_save_commit_after`), the way Adobe's integration starter kit
 * sends orders: after the order is saved, not while the shopper waits.
 *
 * The event carries the order's increment id but not its entity id, so the order is looked
 * up, created in the ERP, and the ERP's number written back as `ext_order_id`. That save
 * raises the event again; an order that is not new, or already has a number, is skipped.
 *
 * I/O Events retries a delivery answered with a 5xx (at 1, 2, 4 and 8 minutes, then every
 * 15 minutes, for up to a day) and drops one answered with a 4xx. So when the ERP cannot
 * take the order, the website's "Hold orders while the ERP is offline" setting decides
 * which of the two this answers. The ERP returns the same number for a repeated order, so a
 * repeated delivery creates nothing twice.
 */
import { partnerHints } from "#lib/webhook";

const ERP_TIMEOUT_MS = 20_000;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;
const UNAVAILABLE = 503;
const BAD_REQUEST = 400;

/** A new order: Commerce marks it, or its first save has equal created and updated times. */
export function isNewOrder(order) {
  if (typeof order._isNew === "boolean") {
    return order._isNew;
  }
  return (
    Boolean(order.created_at) &&
    Date.parse(order.created_at) === Date.parse(order.updated_at)
  );
}

/** The ERP's order request for a Commerce order and its entity id. */
export function erpOrderFrom(order, entityId) {
  const rawItems = order.items ?? [];
  const items = Array.isArray(rawItems) ? rawItems : Object.values(rawItems);
  return {
    commerceIncrementId: String(order.increment_id),
    commerceOrderId: String(entityId),
    currency: order.base_currency_code || "USD",
    lines: items
      .filter((item) => !item.parent_item_id && item.sku)
      .map((item) => ({
        commerceItemId: item.item_id ?? null,
        price: Number(item.base_price ?? item.price ?? 0),
        qty: Number(item.qty_ordered ?? item.qty ?? 1),
        sku: item.sku,
      })),
    total: Number(order.base_grand_total ?? 0),
    ...partnerHints(order),
  };
}

const canRetry = (status) =>
  status === undefined ||
  status === TOO_MANY_REQUESTS ||
  status >= SERVER_ERROR;

/**
 * Send one order event's order to the ERP.
 * @param {object} params action params (ERP and Commerce credentials)
 * @param {object} order the event's `data.value`
 * @param {object} deps `{ erp, findOrder, setExtOrderId, addNote, settingsFor, logger }`
 * @returns {Promise<{ outcome: "sent"|"skipped"|"held"|"dropped", statusCode: number, message: string }>}
 */
export async function sendOrderToErp(params, order, deps) {
  const result = (outcome, statusCode, message) => ({
    message,
    outcome,
    statusCode,
  });
  if (!order?.increment_id) {
    return result("dropped", BAD_REQUEST, "The event carries no order number.");
  }
  const label = `order ${order.increment_id}`;
  if (order.ext_order_id) {
    return result(
      "skipped",
      200,
      `${label} already has ERP number ${order.ext_order_id}.`,
    );
  }
  if (!isNewOrder(order)) {
    return result("skipped", 200, `${label} is not new.`);
  }
  const settings = await deps.settingsFor(order.store_id, deps.logger);
  if (!settings.orders_send) {
    return result(
      "skipped",
      200,
      `${label}: sending orders to the ERP is off for its website.`,
    );
  }
  const found = await deps.findOrder(params, order.increment_id);
  if (!found) {
    return result(
      "held",
      UNAVAILABLE,
      `${label} is not readable in Commerce yet.`,
    );
  }
  if (found.extOrderId) {
    return result(
      "skipped",
      200,
      `${label} already has ERP number ${found.extOrderId}.`,
    );
  }

  let res;
  try {
    res = await deps.erp.createOrder(
      params,
      erpOrderFrom(order, found.entityId),
      ERP_TIMEOUT_MS,
    );
  } catch (error) {
    res = { error: error.message };
  }
  const number = res?.ok ? res.data?.number : undefined;
  if (number) {
    await deps.setExtOrderId(params, found.entityId, number);
    await deps
      .addNote(
        params,
        found.entityId,
        `Created in the ERP as sales order ${number}`,
      )
      .catch((error) =>
        deps.logger?.warn(`${label}: note not added: ${error.message}`),
      );
    return result("sent", 200, `${label} is ERP sales order ${number}.`);
  }

  const reason =
    res?.error || res?.data?.errorMessage || `the ERP answered ${res?.status}`;
  if (!canRetry(res?.status)) {
    return result(
      "dropped",
      BAD_REQUEST,
      `${label} was refused by the ERP: ${reason}`,
    );
  }
  if (settings.orders_hold_offline) {
    return result(
      "held",
      UNAVAILABLE,
      `${label} is waiting for the ERP (${reason}).`,
    );
  }
  return result(
    "dropped",
    BAD_REQUEST,
    `${label} was not sent (${reason}); holding orders is off for its website.`,
  );
}
