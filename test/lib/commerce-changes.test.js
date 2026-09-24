import {
  invoiceFromCommerce,
  mine,
  orderChangeFromCommerce,
  shipmentFromCommerce,
} from "#lib/commerce-changes";

const ok = (data) => ({ data, ok: true, status: 200 });
const gone = { data: {}, ok: false, status: 404 };
const REMAIN = /2 EA remain/u;
const erpOrder = (extra = {}) => ({
  creditStatus: "approved",
  header: "confirmed",
  number: "0000001003",
  ...extra,
});

function deps(overrides = {}) {
  return {
    erp: {
      fromCommerce: {
        cancel: vi.fn(() => Promise.resolve(ok({}))),
        hold: vi.fn(() => Promise.resolve(ok({}))),
        invoice: vi.fn(() => Promise.resolve(ok({}))),
        release: vi.fn(() => Promise.resolve(ok({}))),
        ship: vi.fn(() => Promise.resolve(ok({}))),
      },
      order: vi.fn(() => Promise.resolve(ok(erpOrder()))),
    },
    getOrder: vi.fn(() =>
      Promise.resolve({ entity_id: 55, ext_order_id: "0000001003" }),
    ),
    ...overrides,
  };
}

describe("Given a change made in Commerce", () => {
  test("Then 'is this mine' asks the ERP for the order behind ext_order_id; no number or a 404 is not ours, an ERP failure waits", async () => {
    const d = deps();
    expect(await mine({}, "0000001003", d)).toEqual({
      answer: null,
      number: "0000001003",
      order: erpOrder(),
    });
    expect((await mine({}, null, d)).answer.outcome).toBe("skipped");
    d.erp.order.mockResolvedValueOnce(gone);
    expect((await mine({}, "0000009999", d)).answer.outcome).toBe("skipped");
    d.erp.order.mockResolvedValueOnce({ data: {}, ok: false, status: 503 });
    expect((await mine({}, "0000001003", d)).answer).toMatchObject({
      outcome: "held",
      statusCode: 503,
    });
  });

  test("Then a Commerce shipment is recorded on the ERP order by item id and source, with the origin that stops the echo", async () => {
    const d = deps();
    const result = await shipmentFromCommerce(
      { id: "evt-9" },
      {
        entity_id: 501,
        extension_attributes: { source_code: "east" },
        increment_id: "000000501",
        items: [
          { order_item_id: 1, qty: 5, sku: "A1" },
          { order_item_id: 2, qty: 4, sku: "B2" },
        ],
        order_id: 55,
      },
      d,
    );
    expect(result).toMatchObject({ outcome: "sent", statusCode: 200 });
    expect(d.getOrder).toHaveBeenCalledWith({ id: "evt-9" }, 55);
    expect(d.erp.order).toHaveBeenCalledWith({ id: "evt-9" }, "0000001003");
    expect(d.erp.fromCommerce.ship).toHaveBeenCalledWith(
      { id: "evt-9" },
      "0000001003",
      {
        commerceShipmentId: "501",
        items: [
          { orderItemId: 1, qty: 5 },
          { orderItemId: 2, qty: 4 },
        ],
        origin: {
          event: "observer.sales_order_shipment_save_after",
          eventId: "evt-9",
        },
        sourceCode: "east",
      },
    );
  });

  test("Then a shipment for an order Commerce cannot read yet waits; one for another ERP's order is left alone; a bad event is dropped", async () => {
    const d = deps({ getOrder: vi.fn(() => Promise.resolve(null)) });
    expect(
      (await shipmentFromCommerce({}, { entity_id: 1, order_id: 55 }, d))
        .outcome,
    ).toBe("held");
    const other = deps();
    other.erp.order.mockResolvedValueOnce(gone);
    const result = await shipmentFromCommerce(
      {},
      { entity_id: 1, items: [], order_id: 55 },
      other,
    );
    expect(result.outcome).toBe("skipped");
    expect(other.erp.fromCommerce.ship).not.toHaveBeenCalled();
    expect(
      (await shipmentFromCommerce({}, { items: [] }, deps())).outcome,
    ).toBe("dropped");
  });

  test("Then the ERP's refusal ends the delivery and its outage asks for another", async () => {
    const d = deps();
    d.erp.fromCommerce.ship.mockResolvedValueOnce({
      data: { errorMessage: "Item 10: 2 EA remain of 12." },
      ok: false,
      status: 400,
    });
    const refused = await shipmentFromCommerce(
      {},
      { entity_id: 1, items: [{ order_item_id: 1, qty: 9 }], order_id: 55 },
      d,
    );
    expect(refused).toMatchObject({ outcome: "dropped", statusCode: 400 });
    expect(refused.message).toMatch(REMAIN);
    d.erp.fromCommerce.ship.mockResolvedValueOnce({
      data: {},
      ok: false,
      status: 503,
    });
    expect(
      (
        await shipmentFromCommerce(
          {},
          { entity_id: 1, items: [], order_id: 55 },
          d,
        )
      ).outcome,
    ).toBe("held");
  });

  test("Then a Commerce invoice invoices the ERP order with its Commerce id and the origin", async () => {
    const d = deps();
    const result = await invoiceFromCommerce(
      {},
      { entity_id: 77, increment_id: "000000077", order_id: 55 },
      d,
    );
    expect(result.outcome).toBe("sent");
    expect(d.erp.fromCommerce.invoice).toHaveBeenCalledWith({}, "0000001003", {
      commerceInvoiceId: "77",
      origin: { event: "observer.sales_order_invoice_save_after" },
    });
    expect((await invoiceFromCommerce({}, {}, d)).outcome).toBe("dropped");
  });

  test("Then a cancellation in Commerce cancels the ERP order with Commerce's reason, once", async () => {
    const d = deps();
    const result = await orderChangeFromCommerce(
      {},
      {
        ext_order_id: "0000001003",
        increment_id: "000000042",
        state: "canceled",
      },
      d,
    );
    expect(result.outcome).toBe("sent");
    expect(d.erp.fromCommerce.cancel).toHaveBeenCalledWith({}, "0000001003", {
      origin: { event: "observer.sales_order_save_commit_after" },
      reason: "Cancelled in Commerce",
    });
    d.erp.order.mockResolvedValueOnce(ok(erpOrder({ header: "cancelled" })));
    const again = await orderChangeFromCommerce(
      {},
      { ext_order_id: "0000001003", state: "canceled" },
      d,
    );
    expect(again.outcome).toBe("skipped");
    expect(d.erp.fromCommerce.cancel).toHaveBeenCalledTimes(1);
  });

  test("Then a hold in Commerce holds the ERP order; off hold releases only a hold Commerce made; other saves are nothing to do; a new order is not a change", async () => {
    const d = deps();
    expect(
      (
        await orderChangeFromCommerce(
          {},
          { ext_order_id: "0000001003", state: "holded" },
          d,
        )
      ).outcome,
    ).toBe("sent");
    expect(d.erp.fromCommerce.hold).toHaveBeenCalledWith({}, "0000001003", {
      origin: { event: "observer.sales_order_save_commit_after" },
      reason: "Put on hold in Commerce",
    });
    d.erp.order.mockResolvedValueOnce(
      ok(
        erpOrder({
          creditReason: "Put on hold in Commerce",
          creditStatus: "held",
        }),
      ),
    );
    expect(
      (
        await orderChangeFromCommerce(
          {},
          { ext_order_id: "0000001003", state: "processing" },
          d,
        )
      ).outcome,
    ).toBe("sent");
    expect(d.erp.fromCommerce.release).toHaveBeenCalledTimes(1);
    // A credit hold the ERP decided is the ERP's to release, whatever Commerce's state says.
    d.erp.order.mockResolvedValueOnce(
      ok(
        erpOrder({
          creditReason: "Credit limit 1,000.00 exceeded by 5.00",
          creditStatus: "held",
        }),
      ),
    );
    expect(
      (
        await orderChangeFromCommerce(
          {},
          { ext_order_id: "0000001003", state: "processing" },
          d,
        )
      ).outcome,
    ).toBe("skipped");
    expect(d.erp.fromCommerce.release).toHaveBeenCalledTimes(1);
    expect(
      (
        await orderChangeFromCommerce(
          {},
          { _isNew: true, ext_order_id: "0000001003", state: "new" },
          d,
        )
      ).outcome,
    ).toBe("skipped");
    expect(d.erp.order).toHaveBeenCalledTimes(3);
  });
});
