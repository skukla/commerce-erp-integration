import { cartBuyer, cartLines, partnerHints, readPayload } from "#lib/webhook";

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
  test("Then the cart's buyer is its ids only: cart, customer, group and the company Commerce records on it", () => {
    expect(
      cartBuyer({
        customer_email: "x@acme.example",
        customer_group_id: "1",
        customer_id: "45",
        entity_id: "33",
        extension_attributes: { company_id: 20, shipping_assignments: [] },
      }),
    ).toEqual({
      cartId: "33",
      companyId: 20,
      customerGroupId: "1",
      customerId: "45",
      extensionFields: ["company_id", "shipping_assignments"],
    });
    expect(cartBuyer(undefined)).toEqual({
      cartId: null,
      companyId: null,
      customerGroupId: null,
      customerId: null,
      extensionFields: [],
    });
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
});
