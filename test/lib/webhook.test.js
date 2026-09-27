import { cartBuyer, cartLines, erpBuyer, readPayload } from "#lib/webhook";

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
  test("Then the ERP is asked for the customer the key map pairs with the cart's company, and nothing of Commerce's", async () => {
    const lookup = vi.fn(async (id) => (id === "20" ? "C000200" : null));
    const quote = {
      customer_email: "x@acme.example",
      customer_group_id: "1",
      customer_id: "46",
      extension_attributes: { company_id: 20 },
    };
    expect(await erpBuyer(quote, lookup)).toEqual({ partnerId: "C000200" });
    expect(lookup).toHaveBeenCalledWith("20");
    expect(
      await erpBuyer({ extension_attributes: { company_id: 21 } }, lookup),
    ).toEqual({});
    expect(await erpBuyer({ customer_id: "9" }, lookup)).toEqual({});
    const failing = vi.fn(() => Promise.reject(new Error("state down")));
    expect(await erpBuyer(quote, failing)).toEqual({});
  });
});
