/*
 * What the cart webhooks share: reading the body Runtime hands over, resolving the
 * buyer's business partner, and answering in Commerce's operation shapes. Every failure
 * answers `{ op: "success" }`: a cart is never broken by the ERP being slow or away
 * (decision 6). The order event (lib/order-sync.js) uses the partner hints too.
 */
import {
  ok,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";

/** The whole request body, whichever of Runtime's three shapes it arrived in. */
export function readPayload(params) {
  if (typeof params.__ow_body === "string" && params.__ow_body.length > 0) {
    try {
      return JSON.parse(params.__ow_body);
    } catch {
      try {
        return JSON.parse(
          Buffer.from(params.__ow_body, "base64").toString("utf8"),
        );
      } catch {
        return {};
      }
    }
  }
  return params;
}

/** A response of raw operations (an array or one object). */
export function operations(ops) {
  return ok(ops);
}

/** Leave Commerce's own outcome untouched. */
export function noop() {
  return ok(successOperation());
}

/**
 * The partner hints a cart or order carries: the customer group (a company's shared
 * catalog group), the email domain, the customer id. The ERP resolves them in order.
 * A cart's totals payload carries only the group; an order carries all three.
 */
export function partnerHints(source = {}) {
  const email = source.customer_email || source.customer?.email || null;
  return {
    customerGroupId:
      source.customer_group_id === undefined ||
      source.customer_group_id === null
        ? undefined
        : String(source.customer_group_id),
    customerId: source.customer_id ?? null,
    email,
  };
}

/** Cart lines from a totals-collector payload. */
export function cartLines(payload) {
  const items = payload?.shippingAssignment?.items ?? [];
  return items
    .filter((item) => !item.parent_item_id)
    .map((item) => ({
      basePrice: Number(item.base_price ?? item.price ?? 0),
      itemId: Number(item.item_id),
      nativeDiscount: Math.abs(
        Number(item.base_discount_amount ?? item.discount_amount ?? 0),
      ),
      qty: Number(item.qty ?? 1),
      sku: item.sku,
    }))
    .filter((line) => line.sku && Number.isFinite(line.itemId));
}

/** @returns {number} rounded to cents */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
