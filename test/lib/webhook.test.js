import {
  cartLines,
  extOrderIdOperation,
  partnerHints,
  readPayload,
  toErpOrder,
  unwrapOrder,
} from "#lib/webhook";

describe("Given the webhook helpers", () => {
  test("Then the body is read raw, base64 or from params", () => {
    expect(readPayload({ __ow_body: JSON.stringify({ a: 1 }) })).toEqual({
      a: 1,
    });
    expect(
      readPayload({
        __ow_body: Buffer.from(JSON.stringify({ b: 2 })).toString("base64"),
      }),
    ).toEqual({ b: 2 });
    expect(readPayload({ c: 3 })).toEqual({ c: 3 });
    expect(readPayload({ __ow_body: "not json" })).toEqual({});
  });
  test("Then cart lines skip children and carry qty, price and the native discount", () => {
    const lines = cartLines({
      shippingAssignment: {
        items: [
          {
            base_discount_amount: -4,
            base_price: 20,
            item_id: 5,
            qty: 2,
            sku: "A",
          },
          { item_id: 6, parent_item_id: 5, sku: "child" },
          { item_id: 7 },
        ],
      },
    });
    expect(lines).toEqual([
      { basePrice: 20, itemId: 5, nativeDiscount: 4, qty: 2, sku: "A" },
    ]);
  });
  test("Then partner hints come from the group, the email and the customer id", () => {
    expect(
      partnerHints({
        customer_email: "x@acme.example",
        customer_group_id: 4,
        customer_id: 9,
      }),
    ).toEqual({ customerGroupId: "4", customerId: 9, email: "x@acme.example" });
    expect(partnerHints({})).toEqual({
      customerGroupId: undefined,
      customerId: null,
      email: null,
    });
  });
  test("Then an order-place payload becomes an ERP order with top-level lines", () => {
    const payload = {
      data: {
        order: {
          base_grand_total: 40,
          customer_email: "b@acme.example",
          customer_group_id: 4,
          entity_id: 12,
          increment_id: "000000012",
          items: [
            { base_price: 20, item_id: 1, qty_ordered: 2, sku: "A" },
            { parent_item_id: 1, sku: "child" },
          ],
        },
      },
    };
    expect(unwrapOrder(payload)).toBe(payload.data.order);
    expect(toErpOrder(payload.data.order)).toEqual({
      commerceIncrementId: "000000012",
      commerceOrderId: "12",
      currency: "USD",
      customerGroupId: "4",
      customerId: null,
      email: "b@acme.example",
      lines: [{ commerceItemId: 1, price: 20, qty: 2, sku: "A" }],
      total: 40,
    });
  });
  test("Then the ERP number is written at the payload-relative path", () => {
    expect(extOrderIdOperation("0000001000")).toEqual({
      op: "replace",
      path: "data/order/ext_order_id",
      value: "0000001000",
    });
  });
});
