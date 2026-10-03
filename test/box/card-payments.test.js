/*
 * Pair-in-a-box: an order paid BY CARD at checkout (AB-26s, the card half; owner 2026-10-02,
 * flow 1), split over two REAL mock ERPs (contract version 18) in this process. Commerce
 * captured the card; each ERP's order carries the payment reference and its own share; each
 * ERP's invoice then reads paid with nothing open, no payment event comes back, and the
 * company's credit is untouched. A return and its credit memo still work and move no money in
 * the ERP: refunding the card is Commerce's (it owns the gateway).
 *
 * Order 55 is split: A1 (12 × 10.00) is ERP A's, B2 (4 × 5.00) is ERP B's; the card paid 140.00.
 */
const box = await vi.hoisted(async () => {
  const { createFakeCommerce } = await import("./fake-commerce.js");
  const { startErp } = await import("./erp-in-process.js");
  const { fakeState } = await import("./state.js");
  const { erpClientModule, settingsModule } = await import("./box-modules.js");
  const ERP_B_URL = "https://erp-b.example/api/v1/web/erp";
  const erpA = startErp();
  const erpB = startErp();
  const call = (action, request = {}) =>
    (request.params?.ERP_BASE_URL === ERP_B_URL ? erpB : erpA).call(
      action,
      request,
    );
  return {
    commerce: createFakeCommerce(),
    ERP_B_URL,
    erpA,
    erpB,
    erpClient: erpClientModule(call),
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
import { replaceErps, resetErpsClient } from "#lib/erps";
import * as keyMap from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { readOrderParts } from "#lib/order-parts";
import * as orderCreated from "#src/order/commerce/created/index";
import * as returnSaved from "#src/order/commerce/return-saved/index";

import { deliverErpEvents as deliverThrough } from "./deliver-erp-events.js";
import { fillErp } from "./fill-erp.js";

const ERP_A_URL = "https://erp-a.example/api/v1/web/erp";
const ORDER = "000000042";
const ORDER_ID = 55;
const COMPANY = 7;
const CARD_NUMBER = "4111111111111111";
/** The invoice Commerce made at checkout, each journey's own. */
let checkoutInvoice;

/** Commerce's payment record for a card captured at checkout (Authorize and Capture). */
const CAPTURED = {
  additional_information: ["Credit Card", CARD_NUMBER],
  base_amount_paid: 140,
  cc_last4: "4242",
  cc_number_enc: CARD_NUMBER,
  cc_type: "VI",
  last_trans_id: "8FK21345TX901234A",
  method: "payment_services_paypal_hosted_fields",
};

const deliver = async (erpBox, erpId) =>
  (await deliverThrough(erpBox, { erpId })).map(
    ({ event, params, status }) => ({
      event,
      params,
      status,
    }),
  );
const writesOf = (kind) => box.commerce.writes.filter((w) => w.kind === kind);
const salesOrderIn = async (erpBox) => {
  const row = (await erpBox.call("orders")).data.items.find(
    (o) => o.purchaseOrderByCustomer === ORDER,
  );
  return (await erpBox.call("orders", { path: `/${row.number}` })).data;
};

/** Confirm, ship and invoice a sales order in one ERP, and deliver what it raised. */
async function invoiceIn(erpBox, erpId) {
  const { number } = await salesOrderIn(erpBox);
  await erpBox.call("orders", { method: "POST", path: `/${number}/confirm` });
  await erpBox.call("orders", {
    body: { status: "shipped" },
    method: "POST",
    path: `/${number}/status`,
  });
  await erpBox.call("orders", { method: "POST", path: `/${number}/invoice` });
  return deliver(erpBox, erpId);
}

beforeEach(async () => {
  box.commerce.reset();
  box.erpA.reset();
  box.erpB.reset();
  box.state.reset();
  resetErpsClient(box.state);
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
  await replaceErps([
    {
      adapter: "demo-erp",
      connection: { baseUrl: ERP_A_URL },
      id: "erp",
      name: "ERP A",
    },
    {
      adapter: "demo-erp",
      connection: { baseUrl: box.ERP_B_URL },
      id: "brand-b",
      name: "ERP B",
    },
  ]);
  await fillErp(
    box.commerce.lib,
    {
      importRecords: (_p, body) =>
        erp.importRecords({ ERP_BASE_URL: box.ERP_B_URL }, body),
    },
    "Box",
  );
  const partnerB = await keyMap.erpCustomerOf("7");
  await fillErp(box.commerce.lib, erp, "Box");
  await keyMap.pairCustomer("7", partnerB, "brand-b");
  box.commerce.db.products.get("A1").custom_attributes = { erp_owner: "erp" };
  box.commerce.db.products.get("B2").custom_attributes = {
    erp_owner: "brand-b",
  };
  // Authorize and Capture: the card is captured AND the order invoiced in Commerce at checkout.
  checkoutInvoice = String(box.commerce.captureAtCheckout(ORDER_ID, CAPTURED));
});

describe("Pair in a box: a split order paid by card at checkout", () => {
  test("Each ERP's order carries the reference and its share; each invoice closes paid; no credit moves; a return still credits and moves no money", async () => {
    const placed = await orderCreated.main(
      box.commerce.events.orderSaved(ORDER_ID, { isNew: true }),
    );
    expect(placed.statusCode).toBe(200);

    // Each ERP's order: the reference, its own share, never the card number.
    const reference = (share) => ({
      amount: share,
      cardBrand: "Visa",
      cardLastFour: "4242",
      method: CAPTURED.method,
      reference: CAPTURED.last_trans_id,
    });
    const [orderA, orderB] = [
      await salesOrderIn(box.erpA),
      await salesOrderIn(box.erpB),
    ];
    expect([orderA.payment, orderB.payment]).toStrictEqual([
      reference(120),
      reference(20),
    ]);
    expect([orderA.total, orderB.total]).toStrictEqual([120, 20]);
    // The shares add up to what the card paid, to the cent.
    expect(orderA.payment.amount + orderB.payment.amount).toBe(
      CAPTURED.base_amount_paid,
    );
    expect(JSON.stringify([orderA, orderB])).not.toContain(CARD_NUMBER);
    // Paid at checkout, neither order used the company's credit in its ERP.
    const customers = await Promise.all(
      [
        [box.erpA, orderA],
        [box.erpB, orderB],
      ].map(([erpBox, o]) =>
        erpBox.call("partners", { path: `/${o.partnerId}` }),
      ),
    );
    expect(customers.map((c) => c.data.credit.exposure)).toEqual([0, 0]);

    // Ship and invoice in each ERP: the invoice event comes back, and NO payment event.
    for (const [erpBox, erpId] of [
      [box.erpA, "erp"],
      [box.erpB, "brand-b"],
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: one ERP after the other, as staff would
      const delivered = await invoiceIn(erpBox, erpId);
      expect(delivered.map((d) => [d.event, d.status])).toEqual([
        ["be-observer.sales_order_status_update", 200],
        ["be-observer.sales_order_shipment_create", 200],
        ["be-observer.sales_order_invoice_create", 200],
      ]);
    }
    for (const [erpBox, share] of [
      [box.erpA, 120],
      [box.erpB, 20],
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: one ERP after the other
      const { invoice, payments } = await salesOrderIn(erpBox);
      expect([
        invoice.openAmount,
        invoice.paidAmount,
        invoice.paymentStatus,
      ]).toEqual([0, share, "paid"]);
      expect(payments.map((p) => [p.amount, p.reference])).toEqual([
        [share, CAPTURED.last_trans_id],
      ]);
    }
    // Commerce invoiced every line at checkout, so neither the shipments nor the invoices ask
    // it again (it refuses: "The order does not allow an invoice to be created."). Each ERP's
    // invoice is recorded against the checkout invoice, and each part reads invoiced.
    expect(writesOf("invoice")).toEqual([]);
    expect(writesOf("ship")).toHaveLength(2);
    const notes = writesOf("comment").map((w) => w.comment);
    for (const [erpBox, name] of [
      [box.erpA, "ERP A"],
      [box.erpB, "ERP B"],
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: one ERP after the other
      const { invoice } = await salesOrderIn(erpBox);
      expect(notes).toContain(
        `${name}'s invoice ${invoice.number}: already invoiced in the web shop at checkout (Commerce invoice ${checkoutInvoice}), so no second invoice was made.`,
      );
    }
    const { parts } = await readOrderParts(ORDER);
    expect(
      ["erp", "brand-b"].map((id) => [parts[id].status, parts[id].invoiced]),
    ).toEqual([
      ["invoiced", { 1: 12 }],
      ["invoiced", { 2: 4 }],
    ]);

    // Commerce already holds the money: no company credit given back, nothing ledgered.
    expect(writesOf("increaseBalance")).toEqual([]);
    expect(box.commerce.db.credits.get(COMPANY).balance).toBe(0);
    expect(await ledger.readLedger()).toEqual([]);

    // A return over ERP B's line: received and credited there, one Commerce credit memo.
    const returnId = box.commerce.adminCreateReturn(ORDER_ID, [
      { order_item_id: 2, qty: 1 },
    ]);
    await returnSaved.main(box.commerce.events.returnSaved(returnId));
    const [inB] = (await box.erpB.call("returns")).data.items;
    await box.erpB.call("returns", {
      method: "POST",
      path: `/${inB.number}/receive`,
    });
    await deliver(box.erpB, "brand-b");
    await box.erpB.call("returns", {
      method: "POST",
      path: `/${inB.number}/credit-memo`,
    });
    const credited = await deliver(box.erpB, "brand-b");
    expect(credited.map((d) => [d.event, d.status])).toEqual([
      ["be-observer.sales_order_creditmemo_create", 200],
    ]);
    expect(writesOf("refund").map((w) => w.items)).toEqual([
      [{ order_item_id: 2, qty: 1 }],
    ]);
    // No money moved in the ERP for it: still its one payment; the invoice still reads paid.
    const after = await salesOrderIn(box.erpB);
    expect(after.payments).toHaveLength(1);
    expect([after.invoice.openAmount, after.invoice.paymentStatus]).toEqual([
      0,
      "paid",
    ]);
    expect(writesOf("increaseBalance")).toEqual([]);
  });

  test("Every part canceled in its ERP: the order is held, and the note says the card payment is refunded in the web shop, never to cancel it", async () => {
    await orderCreated.main(
      box.commerce.events.orderSaved(ORDER_ID, { isNew: true }),
    );
    let last = [];
    for (const [erpBox, erpId] of [
      [box.erpA, "erp"],
      [box.erpB, "brand-b"],
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: one ERP after the other, as staff would
      const { number } = await salesOrderIn(erpBox);
      await erpBox.call("orders", {
        body: { reason: "Customer request" },
        method: "POST",
        path: `/${number}/cancel`,
      });
      last = await deliver(erpBox, erpId);
    }
    expect(last.map((d) => [d.event, d.status])).toEqual([
      ["be-observer.sales_order_cancel", 200],
    ]);
    // Commerce keeps an order its checkout invoiced (Order::canCancel): held, never canceled.
    expect(box.commerce.db.orders.get(ORDER_ID).state).toBe("holded");
    expect(writesOf("cancel")).toEqual([]);
    const { number: numberB } = await salesOrderIn(box.erpB);
    expect(writesOf("comment").at(-1).comment).toBe(
      `ERP B: ERP sales order ${numberB} canceled in the ERP: Customer request. Order put On Hold: every part was canceled in its ERP. The card payment was captured at checkout, so Commerce keeps the order: the card payment is refunded in the web shop, with a credit memo from its invoice.`,
    );
  });
});
