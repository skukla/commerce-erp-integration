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
import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";
import {
  OWNS,
  orderPrefix,
  ownershipFilter,
  salesOrgOf,
  withPrefix,
} from "#lib/structure";
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

/**
 * The ERP's order request for a Commerce order and its entity id. The website's settings
 * name the sales organisation the order belongs to (business structure).
 */
export function erpOrderFrom(order, entityId, settings = {}) {
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
    origin: originOf(COMMERCE_EVENTS.orderSaved),
    ...salesOrgOf(settings),
    total: Number(order.base_grand_total ?? 0),
    ...partnerHints(order),
  };
}

/**
 * Which ERP sells a mixed order is the routing layer's call (out of scope); but an order
 * with NO line this ERP owns is not this ERP's at all (rule M3). Under `all`, every order is.
 */
async function hasOwnedLine(params, order, settings, deps) {
  if (ownershipFilter(settings).mode === OWNS.ALL || !deps.ownsSku) {
    return true;
  }
  const rawItems = order.items ?? [];
  const items = Array.isArray(rawItems) ? rawItems : Object.values(rawItems);
  const skus = items
    .filter((item) => !item.parent_item_id && item.sku)
    .map((item) => item.sku);
  for (const sku of skus) {
    // biome-ignore lint/performance/noAwaitInLoops: a few lines, each one read
    if (await deps.ownsSku(params, sku, settings)) {
      return true;
    }
  }
  return false;
}

const canRetry = (status) =>
  status === undefined ||
  status === TOO_MANY_REQUESTS ||
  status >= SERVER_ERROR;

/**
 * Send one order event's order to the ERP.
 * @param {object} params action params (ERP and Commerce credentials)
 * @param {object} order the event's `data.value`
 * @param {object} deps `{ erp, findOrder, setExtOrderId, addNote, settingsFor, ownsSku?, logger }`
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
  if (!(await hasOwnedLine(params, order, settings, deps))) {
    return result(
      "skipped",
      200,
      `no line of ${label} belongs to this ERP (${ownershipFilter(settings).describe})`,
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
      {
        ...erpOrderFrom(order, found.entityId, settings),
        origin: originOf(COMMERCE_EVENTS.orderSaved, params),
      },
      ERP_TIMEOUT_MS,
    );
  } catch (error) {
    res = { error: error.message };
  }
  const number = res?.ok ? res.data?.number : undefined;
  if (number) {
    // The prefix tells this ERP's numbers from another's on the same store (rule M4).
    await deps.setExtOrderId(
      params,
      found.entityId,
      withPrefix(number, orderPrefix(settings, params)),
    );
    await deps
      .addNote(
        params,
        found.entityId,
        `Created in ${params?.ERP_DISPLAY_NAME || "the ERP"} as sales order ${number}`,
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

const NOT_FOUND = 404;

/**
 * Send one order again, from the Commerce Admin screen's Retry. The event that first
 * carried it is long gone, so the order is read from Commerce, and it goes through the
 * same send as the first time — as new, since a retry is exactly a later save. The
 * website's settings still apply, and an order that has an ERP number is left alone.
 * @param {object} params action params (ERP and Commerce credentials)
 * @param {string} incrementId the order number a shopper sees
 * @param {object} deps `sendOrderToErp`'s, plus `getOrder(params, incrementId)`
 * @returns {Promise<{ outcome: string, statusCode: number, message: string }>}
 */
export async function retryOrderToErp(params, incrementId, deps) {
  const order = await deps.getOrder(params, incrementId);
  if (!order) {
    return {
      message: `Commerce has no order ${incrementId}.`,
      outcome: "dropped",
      statusCode: NOT_FOUND,
    };
  }
  return sendOrderToErp(params, { ...order, _isNew: true }, deps);
}
