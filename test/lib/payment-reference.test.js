/*
 * The payment reference an order paid at checkout carries to its ERP (AB-26s, the card half;
 * owner 2026-10-02, flow 1): Commerce captured the money through its own gateway, and the ERP
 * is told how — method, the gateway's transaction id, card brand, last four digits, amount —
 * and NEVER a card number. The reference is built from an allow-list of the Commerce payment
 * record's fields; nothing else on the record can reach the ERP.
 */
import { paymentReferenceOf } from "#lib/payment-reference";

/** A card payment as Commerce's order record answers it, captured at checkout. */
const CAPTURED = {
  additional_information: ["Credit Card", "4111111111111111", "123"],
  amount_ordered: 332.28,
  amount_paid: 332.28,
  base_amount_ordered: 332.28,
  base_amount_paid: 332.28,
  cc_exp_month: "12",
  cc_exp_year: "2030",
  cc_last4: "4242",
  cc_number_enc: "4111111111111111",
  cc_owner: "Pat Buyer",
  cc_type: "VI",
  entity_id: 11,
  last_trans_id: "8FK21345TX901234A",
  method: "payment_services_paypal_hosted_fields",
};

describe("Given the payment on a Commerce order", () => {
  test("Then a captured card payment becomes the reference: method, transaction id, brand, last four, amount", () => {
    expect(paymentReferenceOf(CAPTURED)).toStrictEqual({
      amount: 332.28,
      cardBrand: "Visa",
      cardLastFour: "4242",
      method: "payment_services_paypal_hosted_fields",
      reference: "8FK21345TX901234A",
    });
  });

  test("Then nothing but the five named fields is forwarded: a full card number anywhere on the record never is", () => {
    const loud = {
      ...CAPTURED,
      additional_information: {
        card_number: "4111111111111111",
        cc_number: "4111111111111111",
      },
      extension_attributes: { vault: { number: "4111111111111111" } },
    };
    const reference = paymentReferenceOf(loud);
    expect(Object.keys(reference).sort()).toStrictEqual([
      "amount",
      "cardBrand",
      "cardLastFour",
      "method",
      "reference",
    ]);
    expect(JSON.stringify(reference)).not.toContain("4111111111111111");
    expect(JSON.stringify(reference)).not.toContain("Pat Buyer");
  });

  test("Then a last-four field holding more than four digits, or a brand that is not a name, is left out", () => {
    const reference = paymentReferenceOf({
      ...CAPTURED,
      cc_last4: "4111111111111111",
      cc_type: "4111111111111111",
    });
    expect(reference).toStrictEqual({
      amount: 332.28,
      method: "payment_services_paypal_hosted_fields",
      reference: "8FK21345TX901234A",
    });
  });

  test("Then Commerce's card type codes read as brand names, and a name is kept as it is", () => {
    const brand = (cc_type) =>
      paymentReferenceOf({ ...CAPTURED, cc_type }).cardBrand;
    expect(["VI", "MC", "AE", "DI", "JCB", "DN"].map(brand)).toStrictEqual([
      "Visa",
      "Mastercard",
      "American Express",
      "Discover",
      "JCB",
      "Diners Club",
    ]);
    expect(brand("Visa")).toBe("Visa");
    expect(brand(" visa ")).toBe("visa");
  });

  test("Then only captured money counts: an authorization alone, or a payment with no gateway transaction, is no reference", () => {
    // Authorize only: nothing paid yet.
    expect(
      paymentReferenceOf({
        ...CAPTURED,
        amount_paid: null,
        base_amount_paid: null,
      }),
    ).toBeNull();
    expect(paymentReferenceOf({ ...CAPTURED, base_amount_paid: 0 })).toBeNull();
    // Check / money order, invoiced: paid, but no gateway took it (the captured fixture's shape).
    expect(
      paymentReferenceOf({
        additional_information: ["Check / Money order"],
        base_amount_paid: 180,
        cc_last4: null,
        method: "checkmo",
      }),
    ).toBeNull();
    expect(paymentReferenceOf({ ...CAPTURED, last_trans_id: "  " })).toBeNull();
  });

  test("Then Payment on Account is never a payment reference, whatever the record carries", () => {
    expect(
      paymentReferenceOf({ ...CAPTURED, method: "companycredit" }),
    ).toBeNull();
  });

  test("Then no payment, or junk, is no reference", () => {
    expect(paymentReferenceOf(undefined)).toBeNull();
    expect(paymentReferenceOf(null)).toBeNull();
    expect(paymentReferenceOf("card")).toBeNull();
  });

  test("Then one ERP's part of a split order carries its own share, never more than was captured", () => {
    expect(paymentReferenceOf(CAPTURED, 274.86).amount).toBe(274.86);
    expect(paymentReferenceOf(CAPTURED, 500).amount).toBe(332.28);
    expect(paymentReferenceOf(CAPTURED, 0)).toBeNull();
  });
});
