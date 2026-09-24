/*
 * Changes made IN Commerce Admin flow back to the ERP (bidirectional review, item 1 and
 * G4): a shipment, an invoice, a cancellation, a hold. Each is told to the ERP with an
 * `origin` marker so the ERP records it and does not echo it. Pure over the collaborators
 * it is handed, so it is tested without either system.
 *
 * "Is this mine?" (rule M2 of the multi-ERP review): the Commerce order carries the ERP's
 * number as ext_order_id; the ERP is asked for that order first. An order the ERP does not
 * know is another pair's, or was never sent, and is left alone with a 4xx that ends the
 * delivery.
 */
import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";

const OK = 200;
const BAD_REQUEST = 400;
const UNAVAILABLE = 503;

const answer = (outcome, statusCode, message) => ({
  message,
  outcome,
  statusCode,
});

/**
 * The ERP order behind a Commerce order, or the answer that ends the delivery.
 * @param {object} deps `{ erp }`
 * @param {string|null|undefined} extOrderId the Commerce order's ext_order_id
 * @returns {Promise<{ answer: object|null, number: string|null, order: object|null }>} `answer`
 *   is the outcome that ends this delivery when the order is not this ERP's
 */
export async function mine(params, extOrderId, deps) {
  const not = (result) => ({ answer: result, number: null, order: null });
  if (!extOrderId) {
    return not(
      answer(
        "skipped",
        OK,
        "the order carries no ERP number; not this ERP's, or never sent",
      ),
    );
  }
  const own = await deps.erp.order(params, extOrderId);
  if (own.ok) {
    return { answer: null, number: String(extOrderId), order: own.data };
  }
  if (own.status === 404) {
    return not(
      answer("skipped", OK, `sales order ${extOrderId} is not this ERP's`),
    );
  }
  return not(
    answer(
      "held",
      UNAVAILABLE,
      `the ERP answered ${own.status} for sales order ${extOrderId}`,
    ),
  );
}

/** What the ERP answered, as this handler's outcome. */
function fromErp(res, label, done) {
  if (res.ok) {
    return answer("sent", OK, `${label}: ${done}`);
  }
  const reason = res.data?.errorMessage || `the ERP answered ${res.status}`;
  if (res.status >= 500 || res.status === 429) {
    return answer(
      "held",
      UNAVAILABLE,
      `${label} is waiting for the ERP (${reason})`,
    );
  }
  return answer(
    "dropped",
    BAD_REQUEST,
    `${label} was refused by the ERP: ${reason}`,
  );
}

/**
 * A shipment saved in Commerce: the ERP records a posted shipment of its own.
 * @param {object} shipment the event's value (order_id, entity_id, items[], extension_attributes.source_code)
 * @param {object} deps `{ erp, getOrder(params, orderId) }`
 */
export async function shipmentFromCommerce(params, shipment, deps) {
  const orderId = Number(shipment?.order_id);
  const shipmentId = shipment?.entity_id;
  if (
    !Number.isFinite(orderId) ||
    shipmentId === undefined ||
    shipmentId === null
  ) {
    return answer(
      "dropped",
      BAD_REQUEST,
      "the shipment event carries no order_id or entity_id",
    );
  }
  const order = await deps.getOrder(params, orderId);
  if (!order) {
    return answer(
      "held",
      UNAVAILABLE,
      `Commerce order ${orderId} is not readable yet`,
    );
  }
  const own = await mine(params, order.ext_order_id, deps);
  if (own.answer !== null) {
    return own.answer;
  }
  const items = (
    Array.isArray(shipment.items)
      ? shipment.items
      : Object.values(shipment.items ?? {})
  )
    .filter((item) => item && item.order_item_id !== undefined)
    .map((item) => ({
      orderItemId: Number(item.order_item_id),
      qty: Number(item.qty),
    }));
  const res = await deps.erp.fromCommerce.ship(params, own.number, {
    commerceShipmentId: String(shipmentId),
    items,
    origin: originOf(COMMERCE_EVENTS.shipmentSaved, params),
    sourceCode: shipment.extension_attributes?.source_code ?? null,
  });
  return fromErp(
    res,
    `Commerce shipment ${shipment.increment_id ?? shipmentId}`,
    `recorded on sales order ${own.number}`,
  );
}

/**
 * An invoice saved in Commerce: the ERP invoices the order too.
 * @param {object} deps `{ erp, getOrder(params, orderId) }`
 */
export async function invoiceFromCommerce(params, invoice, deps) {
  const orderId = Number(invoice?.order_id);
  if (!Number.isFinite(orderId)) {
    return answer(
      "dropped",
      BAD_REQUEST,
      "the invoice event carries no order_id",
    );
  }
  const order = await deps.getOrder(params, orderId);
  if (!order) {
    return answer(
      "held",
      UNAVAILABLE,
      `Commerce order ${orderId} is not readable yet`,
    );
  }
  const own = await mine(params, order.ext_order_id, deps);
  if (own.answer !== null) {
    return own.answer;
  }
  const res = await deps.erp.fromCommerce.invoice(params, own.number, {
    commerceInvoiceId:
      invoice.entity_id === undefined || invoice.entity_id === null
        ? null
        : String(invoice.entity_id),
    origin: originOf(COMMERCE_EVENTS.invoiceSaved, params),
  });
  return fromErp(
    res,
    `Commerce invoice ${invoice.increment_id ?? invoice.entity_id}`,
    `recorded on sales order ${own.number}`,
  );
}

/** Commerce's state words this handler acts on. */
const CANCELED = "canceled";
const HOLDED = "holded";

/**
 * A non-new order save in Commerce: a cancellation or a hold made there reaches the ERP,
 * and an order taken off hold in Commerce releases the ERP's hold. Any other save is
 * nothing to do. (The first save, the new order, is order-sync's.)
 * @param {object} order the event's value (state, ext_order_id, increment_id, _isNew)
 * @param {object} deps `{ erp }`
 */
export async function orderChangeFromCommerce(params, order, deps) {
  if (order?._isNew === true) {
    return answer(
      "skipped",
      OK,
      "a new order is the order send's, not a change",
    );
  }
  const own = await mine(params, order?.ext_order_id, deps);
  if (own.answer !== null) {
    return own.answer;
  }
  const label = `Commerce order ${order.increment_id ?? own.number}`;
  const origin = originOf(COMMERCE_EVENTS.orderSaved, params);
  if (order.state === CANCELED) {
    if (own.order.header === "cancelled") {
      return answer(
        "skipped",
        OK,
        `${label}: the ERP already shows it cancelled`,
      );
    }
    const res = await deps.erp.fromCommerce.cancel(params, own.number, {
      origin,
      reason: "Cancelled in Commerce",
    });
    return fromErp(res, label, `cancelled on sales order ${own.number}`);
  }
  if (order.state === HOLDED) {
    if (own.order.creditStatus === "held") {
      return answer("skipped", OK, `${label}: the ERP already holds it`);
    }
    const res = await deps.erp.fromCommerce.hold(params, own.number, {
      origin,
      reason: "Put on hold in Commerce",
    });
    return fromErp(res, label, `held on sales order ${own.number}`);
  }
  if (
    own.order.creditStatus === "held" &&
    own.order.creditReason === "Put on hold in Commerce"
  ) {
    // Off hold in Commerce: only a hold Commerce itself made is released here. A credit hold the
    // ERP decided stays until someone releases it in the ERP.
    const res = await deps.erp.fromCommerce.release(params, own.number, {
      origin,
    });
    return fromErp(res, label, `released on sales order ${own.number}`);
  }
  return answer(
    "skipped",
    OK,
    `${label}: a save the ERP has nothing to do for (state ${order.state ?? "unknown"})`,
  );
}
