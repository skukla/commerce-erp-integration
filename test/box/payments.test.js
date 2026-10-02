/*
 * Pair-in-a-box: the payment leg, end to end, with the REAL mock ERP (contract version 14) in
 * this process and the fake Commerce in front (AB-26s, payment-leg-design.md slice S2). An order
 * paid on account is invoiced in the ERP; a payment posted there gives the company that much
 * credit back in Commerce, once, however often the event is delivered; a demo reset takes it
 * back. An order paid another way changes no credit.
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
vi.mock("#lib/company-balance", () => box.commerce.balance);
vi.mock("#src/order/commerce-order-api-client", () => box.commerce.orderClient);
vi.mock(
  "#src/order/commerce-shipment-api-client",
  () => box.commerce.shipmentClient,
);
vi.mock("#src/stock/commerce-stock-api-client", () => box.commerce.stockClient);

import { erp } from "#lib/erp";
import * as keyMap from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { splitExtOrderId } from "#lib/structure";
import * as detachAction from "#src/erp/detach/index";
import * as orderCreated from "#src/order/commerce/created/index";
import * as erpPayment from "#src/order/external/payment-received/index";

import { deliverErpEvents as deliverThrough } from "./deliver-erp-events.js";
import { fillErp } from "./fill-erp.js";

/** Deliver every pending ERP event through the ingestion webhook's translation (deliver-erp-events.js). */
async function deliverErpEvents() {
  return (await deliverThrough(box.erp)).map(({ event, params, status }) => ({
    event,
    params,
    status,
  }));
}

const ORDER_ID = 55;
const COMPANY = 7;
const CREDIT_ID = 42;
const writesOf = (kind) => box.commerce.writes.filter((w) => w.kind === kind);
const balance = () => box.commerce.db.credits.get(COMPANY).balance;
const comments = () => writesOf("comment").map((w) => w.comment);

/** Order 55 paid this way, filled into the ERP, sent, confirmed, shipped and invoiced there. */
async function invoicedOrder(method) {
  const order = box.commerce.db.orders.get(ORDER_ID);
  order.payment = { method };
  order.extension_attributes = {
    ...order.extension_attributes,
    company_order_attributes: { company_id: COMPANY },
  };
  await fillErp(box.commerce.lib, erp, "Box");
  await orderCreated.main(
    box.commerce.events.orderSaved(ORDER_ID, { isNew: true }),
  );
  const { number } = splitExtOrderId(order.ext_order_id);
  await box.erp.call("orders", { method: "POST", path: `/${number}/confirm` });
  await box.erp.call("orders", {
    body: { status: "shipped" },
    method: "POST",
    path: `/${number}/status`,
  });
  await box.erp.call("orders", { method: "POST", path: `/${number}/invoice` });
  await deliverErpEvents();
  const { invoice } = (await box.erp.call("orders", { path: `/${number}` }))
    .data;
  expect(invoice?.number).toBeTruthy();
  return invoice.number;
}

/** The ERP posts an incoming payment against the invoice, and the box delivers its event. */
async function pay(invoiceNumber, amount) {
  const posted = await box.erp.call("invoices", {
    body: { amount, reference: "Wire 88" },
    method: "POST",
    path: `/${invoiceNumber}/payments`,
  });
  expect(posted.status).toBe(201);
  const delivered = await deliverErpEvents();
  return { delivered, payment: posted.data };
}

beforeEach(() => {
  box.commerce.reset();
  box.erp.reset();
  box.state.reset();
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
});

describe("Pair in a box: an ERP payment, ERP → Commerce", () => {
  test("A payment on an order paid on account gives the company that credit back once, and a reset takes it back", async () => {
    const invoiceNumber = await invoicedOrder("companycredit");

    const { delivered, payment } = await pay(invoiceNumber, 50);

    expect(delivered.map((d) => [d.event, d.status])).toEqual([
      ["be-observer.sales_order_payment_create", 200],
    ]);
    expect(writesOf("increaseBalance")).toEqual([
      {
        comment: `Paid in the ERP (payment ${payment.number}, invoice ${invoiceNumber})`,
        creditId: CREDIT_ID,
        currency: "USD",
        kind: "increaseBalance",
        orderIncrement: "000000042",
        purchaseOrder: payment.number,
        value: 50,
      },
    ]);
    expect(balance()).toBe(50);
    expect(comments()).toContain(`Paid in the ERP (payment ${payment.number})`);

    // I/O Events delivers the payment event again: nothing is reimbursed twice.
    expect((await erpPayment.main(delivered[0].params)).statusCode).toBe(200);
    expect(writesOf("increaseBalance")).toHaveLength(1);
    expect(balance()).toBe(50);

    // The demo is reset: the reimbursement is taken back, to the cent.
    const reset = await detachAction.main({ __ow_method: "post" });
    expect(reset.statusCode).toBe(200);
    expect(writesOf("decreaseBalance")).toEqual([
      expect.objectContaining({
        creditId: CREDIT_ID,
        purchaseOrder: payment.number,
        value: 50,
      }),
    ]);
    expect(balance()).toBe(0);
    expect(await ledger.readLedger()).toEqual([]);
  });

  test("A payment on an order paid by check changes no credit; the order is noted", async () => {
    const invoiceNumber = await invoicedOrder("checkmo");

    const { delivered, payment } = await pay(invoiceNumber, 50);

    expect(delivered[0].status).toBe(200);
    expect(writesOf("increaseBalance")).toEqual([]);
    expect(balance()).toBe(0);
    expect(comments()).toContain(`Paid in the ERP (payment ${payment.number})`);
    expect(await ledger.readLedger()).toEqual([]);
  });
});
