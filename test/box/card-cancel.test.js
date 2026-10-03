/*
 * Pair-in-a-box: the ERP cancels an order the web shop took a card payment for at checkout
 * (AB-26s; owner 2026-10-02, flow 1: the web shop owns the card gateway, and nothing in the
 * ERP or this integration moves card money).
 *
 * Commerce captured the card at checkout, which invoiced the order there (Authorize and
 * Capture), so Commerce cannot cancel it (Order::canCancel: nothing left to invoice). The ERP
 * has not invoiced it, so the ERP's cancel moves no money and stands. Commerce keeps the order
 * On Hold so nothing ships, and both sides say plainly that the card payment is refunded in
 * the web shop, with a credit memo from its invoice. The integration makes no credit memo.
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
import * as keyMap from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { splitExtOrderId } from "#lib/structure";
import * as orderCreated from "#src/order/commerce/created/index";

import { deliverErpEvents } from "./deliver-erp-events.js";
import { fillErp } from "./fill-erp.js";

const writesOf = (kind) => box.commerce.writes.filter((w) => w.kind === kind);

/** Commerce's order 55 as Authorize and Capture leaves it: card captured, invoiced at checkout. */
function capturedAtCheckout() {
  const order = box.commerce.db.orders.get(55);
  order.payment = {
    base_amount_paid: 140,
    cc_last4: "4242",
    cc_type: "VI",
    last_trans_id: "8FK21345TX901234A",
    method: "payment_services_paypal_hosted_fields",
  };
  order.state = "processing";
  order.status = "processing";
  for (const item of order.items) {
    item.qty_invoiced = item.qty_ordered;
  }
}

beforeEach(() => {
  box.commerce.reset();
  box.erp.reset();
  box.state.reset();
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
});

describe("Pair in a box: the ERP cancels an order paid by card at checkout", () => {
  test("The ERP's cancel stands and moves no money; Commerce keeps the order On Hold and says the card payment is refunded in the web shop; no credit memo is made", async () => {
    await fillErp(box.commerce.lib, erp, "Box");
    capturedAtCheckout();
    await orderCreated.main(
      box.commerce.events.orderSaved(55, { isNew: true }),
    );
    const { number } = splitExtOrderId(
      box.commerce.db.orders.get(55).ext_order_id,
    );
    expect((await erp.order({}, number)).data.payment.reference).toBe(
      "8FK21345TX901234A",
    );

    const canceled = await box.erp.call("orders", {
      body: { reason: "Customer request" },
      method: "POST",
      path: `/${number}/cancel`,
    });
    expect(canceled.status).toBe(200);
    // The ERP's own record of it: canceled, nothing invoiced or paid, and why no money moved.
    expect(canceled.data.status).toBe("canceled");
    expect([canceled.data.invoice, canceled.data.payments]).toEqual([null, []]);
    expect(canceled.data.history.at(-1)).toMatchObject({
      note: "Paid by card in the web shop: the card payment is refunded there, not by the ERP.",
      reason: "Customer request",
      status: "canceled",
    });

    expect(
      (await deliverErpEvents(box.erp)).map((d) => [d.event, d.status]),
    ).toEqual([["be-observer.sales_order_cancel", 200]]);
    const order = box.commerce.db.orders.get(55);
    expect(order.state).toBe("holded");
    expect(writesOf("cancel")).toEqual([]);
    expect(writesOf("hold")).toHaveLength(1);
    expect(writesOf("refund")).toEqual([]);
    expect(
      writesOf("comment")
        .map((w) => w.comment)
        .slice(2),
    ).toEqual([
      `Canceled in the ERP (ERP sales order ${number}): Customer request. The card payment was captured at checkout, so Commerce keeps the order: the card payment is refunded in the web shop, with a credit memo from its invoice. It is On Hold so nothing ships; take it off hold to make the credit memo.`,
    ]);
  });
});
