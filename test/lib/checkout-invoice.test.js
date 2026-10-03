import { checkoutInvoiceOf } from "#lib/checkout-invoice";

/** A card captured at checkout (Authorize and Capture), as the Commerce order's payment record. */
const CAPTURED = {
  base_amount_paid: 140,
  last_trans_id: "8FK21345TX901234A",
  method: "payment_services_paypal_hosted_fields",
};
const ORDER = {
  created_at: "2026-09-24 10:00:00",
  entity_id: 55,
  increment_id: "000000042",
  payment: CAPTURED,
};
/** The Invoice Saved event's value: only the fields its subscription names. */
const EVENT = {
  entity_id: 900,
  increment_id: "000000900",
  order_id: 55,
  state: 2,
};
const PARAMS = { COMMERCE_BASE_URL: "https://commerce.example/" };

function depsFor(order, invoiceCreatedAt) {
  return {
    getInvoice: vi.fn(async () => ({
      created_at: invoiceCreatedAt,
      entity_id: 900,
    })),
    getOrder: vi.fn(async () => order),
  };
}

describe("checkoutInvoiceOf", () => {
  test("an invoice made with a card-captured order is the checkout invoice: told to no ERP, recorded as done", async () => {
    const deps = depsFor(ORDER, "2026-09-24 10:00:02");

    const result = await checkoutInvoiceOf(PARAMS, EVENT, deps);

    expect(deps.getOrder).toHaveBeenCalledWith(PARAMS, 55);
    expect(deps.getInvoice).toHaveBeenCalledWith(PARAMS, 900);
    expect(result).toEqual({
      message:
        "Commerce invoice 000000900 was made at checkout, when the card payment was captured: no ERP is told of it, as each ERP records that payment from the order's payment reference.",
      orderRef: "000000042",
      outcome: "done",
      statusCode: 200,
    });
  });

  test("an invoice made a minute after the order is the checkout invoice; one made later is not", async () => {
    expect(
      await checkoutInvoiceOf(
        PARAMS,
        EVENT,
        depsFor(ORDER, "2026-09-24 10:01:00"),
      ),
    ).toMatchObject({ outcome: "done" });
    expect(
      await checkoutInvoiceOf(
        PARAMS,
        EVENT,
        depsFor(ORDER, "2026-09-24 10:01:01"),
      ),
    ).toBeNull();
  });

  test("an order with nothing captured at checkout is never asked about its invoice", async () => {
    for (const payment of [
      { method: "companycredit" },
      { base_amount_authorized: 140, method: CAPTURED.method },
      undefined,
    ]) {
      const deps = depsFor({ ...ORDER, payment }, ORDER.created_at);
      // biome-ignore lint/performance/noAwaitInLoops: one payment record at a time
      expect(await checkoutInvoiceOf(PARAMS, EVENT, deps)).toBeNull();
      expect(deps.getInvoice).not.toHaveBeenCalled();
    }
  });

  test("a time missing or unreadable on either side is not a checkout invoice (today's path decides)", async () => {
    expect(
      await checkoutInvoiceOf(PARAMS, EVENT, depsFor(ORDER, undefined)),
    ).toBeNull();
    expect(
      await checkoutInvoiceOf(
        PARAMS,
        EVENT,
        depsFor({ ...ORDER, created_at: "not a time" }, "2026-09-24 10:00:00"),
      ),
    ).toBeNull();
  });

  test("an event with no order or invoice id, or an order Commerce cannot read, is left to today's path", async () => {
    const deps = depsFor(ORDER, ORDER.created_at);
    expect(
      await checkoutInvoiceOf(PARAMS, { entity_id: 900 }, deps),
    ).toBeNull();
    expect(await checkoutInvoiceOf(PARAMS, { order_id: 55 }, deps)).toBeNull();
    expect(deps.getOrder).not.toHaveBeenCalled();
    expect(
      await checkoutInvoiceOf(PARAMS, EVENT, depsFor(null, ORDER.created_at)),
    ).toBeNull();
  });
});
