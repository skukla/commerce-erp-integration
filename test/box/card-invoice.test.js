/*
 * Pair-in-a-box: one ERP invoices an order Commerce has invoiced already (AB-26s). A card
 * captured at checkout with Authorize and Capture makes Commerce invoice every line there, so
 * when the ERP's own invoice comes back, Commerce has nothing left to invoice and refuses
 * another ("The order does not allow an invoice to be created."): the event failed and was
 * delivered again for nothing. The ERP's invoice is noted against the Commerce invoice that
 * covers it instead. Where only some lines were invoiced in Commerce, only the rest is.
 */
const box = await vi.hoisted(async () => {
  const { createFakeCommerce } = await import("./fake-commerce.js");
  const { startErp } = await import("./erp-in-process.js");
  const { fakeState } = await import("./state.js");
  const { erpClientModule, settingsModule } = await import("./box-modules.js");
  const erpBox = startErp();
  return {
    commerce: createFakeCommerce(),
    erp: erpBox,
    erpClient: erpClientModule(erpBox.call),
    settings: settingsModule(),
    state: fakeState(),
  };
});

vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: async () => box.state },
}));
vi.mock("#lib/settings", () => box.settings);
vi.mock("#lib/erp", () => box.erpClient);
vi.mock("#lib/commerce", () => box.commerce.lib);
vi.mock("#lib/commerce-before", () => box.commerce.before);
vi.mock("#src/order/commerce-order-api-client", () => box.commerce.orderClient);
vi.mock(
  "#src/order/commerce-shipment-api-client",
  () => box.commerce.shipmentClient,
);
vi.mock("#src/stock/commerce-stock-api-client", () => box.commerce.stockClient);

import { erp } from "#lib/erp";
import { readHistory } from "#lib/history";
import * as keyMap from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { splitExtOrderId } from "#lib/structure";
import * as orderCreated from "#src/order/commerce/created/index";
import * as orderInvoiced from "#src/order/commerce/invoiced/index";

import { deliverErpEvents } from "./deliver-erp-events.js";
import { fillErp } from "./fill-erp.js";

const ORDER_ID = 55;
/** Commerce's payment record for a card captured at checkout (Authorize and Capture). */
const CAPTURED = {
  base_amount_paid: 140,
  cc_last4: "4242",
  cc_type: "VI",
  last_trans_id: "8FK21345TX901234A",
  method: "payment_services_paypal_hosted_fields",
};
const writesOf = (kind) => box.commerce.writes.filter((w) => w.kind === kind);

/** Send order 55 to the ERP; answers its sales order number there. */
async function placed() {
  await fillErp(box.commerce.lib, erp, "Box");
  await orderCreated.main(
    box.commerce.events.orderSaved(ORDER_ID, { isNew: true }),
  );
  return splitExtOrderId(box.commerce.db.orders.get(ORDER_ID).ext_order_id)
    .number;
}

/** Confirm, ship and invoice it in the ERP; deliver what that raised; answer the ERP invoice. */
async function invoicedInErp(number) {
  await box.erp.call("orders", { method: "POST", path: `/${number}/confirm` });
  await box.erp.call("orders", {
    body: { status: "shipped" },
    method: "POST",
    path: `/${number}/status`,
  });
  await box.erp.call("orders", { method: "POST", path: `/${number}/invoice` });
  const delivered = await deliverErpEvents(box.erp);
  const { invoice } = (await box.erp.call("orders", { path: `/${number}` }))
    .data;
  return { delivered, invoiceNumber: invoice.number };
}

beforeEach(() => {
  box.commerce.reset();
  box.erp.reset();
  box.state.reset();
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
});

describe("Pair in a box: the ERP invoices an order Commerce invoiced already", () => {
  test("A card captured at checkout: the ERP's invoice makes no second Commerce invoice, succeeds, and is noted against the checkout invoice", async () => {
    const checkout = box.commerce.captureAtCheckout(ORDER_ID, {
      base_amount_paid: 140,
      cc_last4: "4242",
      cc_type: "VI",
      last_trans_id: "8FK21345TX901234A",
      method: "payment_services_paypal_hosted_fields",
    });
    const number = await placed();

    const { delivered, invoiceNumber } = await invoicedInErp(number);

    expect(delivered.map((d) => [d.event, d.status])).toEqual([
      ["be-observer.sales_order_status_update", 200],
      ["be-observer.sales_order_shipment_create", 200],
      ["be-observer.sales_order_invoice_create", 200],
    ]);
    expect(writesOf("invoice")).toEqual([]);
    expect(box.commerce.db.invoices.map((i) => i.entity_id)).toEqual([
      checkout,
    ]);
    expect(writesOf("comment").at(-1).comment).toBe(
      `Invoiced in the ERP (ERP sales order ${number}, invoice ${invoiceNumber}); already invoiced in the web shop at checkout (Commerce invoice ${checkout}), so no second invoice was made`,
    );
  });

  test("Some lines invoiced in Commerce before: only the rest is invoiced, and the note names the lines Commerce had", async () => {
    box.commerce.db.orders.get(ORDER_ID).payment = { method: "companycredit" };
    const number = await placed();
    // Staff invoiced A1 in Commerce Admin before the ERP did.
    const before = await box.commerce.orderClient.invoiceOrderItems(
      {},
      ORDER_ID,
      [{ order_item_id: 1, qty: 12 }],
    );
    box.commerce.writes.length = 0;

    const { delivered, invoiceNumber } = await invoicedInErp(number);

    expect(delivered.at(-1)).toMatchObject({
      event: "be-observer.sales_order_invoice_create",
      status: 200,
    });
    const [invoice] = writesOf("invoice");
    expect(
      box.commerce.db.invoices.find((i) => i.entity_id === invoice.invoiceId)
        .items,
    ).toEqual([{ order_item_id: 2, qty: 4 }]);
    expect(writesOf("comment").at(-1).comment).toBe(
      `Invoiced in the ERP (ERP sales order ${number}, invoice ${invoiceNumber}); A1 already invoiced in Commerce (Commerce invoice ${before}), so only the rest was invoiced`,
    );
  });
});

/*
 * AB-66: Commerce raises Invoice Saved for the invoice it made at checkout, and I/O Events can
 * deliver it late, after the order reached the ERP and before the ERP confirmed it. Passed on,
 * the ERP is asked to invoice an order it has not confirmed, refuses, and the event fails.
 */
describe("Pair in a box: the checkout invoice's event arrives after the order reached the ERP", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("A card captured at checkout: the ERP is not told of the checkout invoice; 200, and the Activity says why", async () => {
    const checkout = box.commerce.captureAtCheckout(ORDER_ID, CAPTURED);
    const number = await placed();
    const told = vi.spyOn(erp.fromCommerce, "invoice");

    const res = await orderInvoiced.main(
      box.commerce.events.invoiceSaved(checkout),
    );

    const message = `Commerce invoice ${checkout} was made at checkout, when the card payment was captured: no ERP is told of it, as each ERP records that payment from the order's payment reference.`;
    expect(res).toMatchObject({ body: { message }, statusCode: 200 });
    expect(told).not.toHaveBeenCalled();
    const inErp = (await box.erp.call("orders", { path: `/${number}` })).data;
    expect(inErp.invoice ?? null).toBeNull();
    expect(
      (await readHistory({ ref: String(checkout) })).map((r) => [
        r.kind,
        r.outcome,
        r.message,
        r.orderRef,
      ]),
    ).toEqual([["invoiced", "done", message, "000000042"]]);
  });

  test("An invoice a merchant makes later, capturing a card authorized at checkout, is still passed to the ERP", async () => {
    box.commerce.db.orders.get(ORDER_ID).payment = {
      base_amount_authorized: 140,
      method: "payment_services_paypal_hosted_fields",
    };
    const number = await placed();
    await box.erp.call("orders", {
      method: "POST",
      path: `/${number}/confirm`,
    });
    await box.erp.call("orders", {
      body: { status: "shipped" },
      method: "POST",
      path: `/${number}/status`,
    });
    await deliverErpEvents(box.erp);
    // Staff invoice in Commerce Admin, capturing the card: the order now reads paid.
    const invoiceId = await box.commerce.adminInvoice(ORDER_ID);
    Object.assign(box.commerce.db.orders.get(ORDER_ID).payment, {
      base_amount_paid: 140,
      last_trans_id: "9QX55512AB0000001",
    });
    const told = vi.spyOn(erp.fromCommerce, "invoice");

    const res = await orderInvoiced.main(
      box.commerce.events.invoiceSaved(invoiceId),
    );

    expect(res.statusCode).toBe(200);
    expect(told).toHaveBeenCalledWith(
      expect.anything(),
      number,
      expect.objectContaining({ externalReference: String(invoiceId) }),
    );
    const inErp = (await box.erp.call("orders", { path: `/${number}` })).data;
    expect(inErp.invoice.externalReference).toBe(String(invoiceId));
  });
});
