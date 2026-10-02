/*
 * Pair-in-a-box: a return, end to end, with the REAL mock ERP (contract version 13) in this
 * process and the fake Commerce in front (returns-design.md, slices D to F). A buyer's return
 * in Commerce becomes a return order in the ERP; the ERP receives the goods and credits them;
 * Commerce ends with one credit memo of exactly the returned line and the return closed. A
 * redelivered event or a later save of the return makes nothing twice.
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
import * as returnSaved from "#src/order/commerce/return-saved/index";
import * as erpCreditMemo from "#src/order/external/creditmemo-created/index";
import * as erpInvoiceCreated from "#src/order/external/invoice-created/index";
import * as erpReturnUpdated from "#src/order/external/return-updated/index";
import * as erpShipmentCreated from "#src/order/external/shipment-created/index";
import * as erpStatus from "#src/order/external/updated/index";
import * as erpStock from "#src/stock/external/updated/index";

import { fillErp } from "./fill-erp.js";

/** Which handler each ERP event this journey raises reaches (app.commerce.config.ts). */
const ERP_HANDLERS = {
  "be-observer.catalog_stock_update": erpStock,
  "be-observer.rma_status_update": erpReturnUpdated,
  "be-observer.sales_order_creditmemo_create": erpCreditMemo,
  "be-observer.sales_order_invoice_create": erpInvoiceCreated,
  "be-observer.sales_order_shipment_create": erpShipmentCreated,
  "be-observer.sales_order_status_update": erpStatus,
};

/** Deliver every pending ERP event to its handler; answers each event and its status. */
async function deliverErpEvents() {
  const delivered = [];
  for (const entry of await box.erp.pendingEvents()) {
    const handler = ERP_HANDLERS[entry.event];
    if (!handler) {
      throw new Error(`no handler for ERP event ${entry.event}`);
    }
    const params = { data: entry.value, id: entry._id, type: entry.event };
    // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as they were raised
    const res = await handler.main(params);
    delivered.push({
      event: entry.event,
      params,
      status: res.statusCode ?? res.error?.statusCode,
    });
    await box.erp.markDelivered(entry);
  }
  return delivered;
}

const ORDER_ID = 55;
const writesOf = (kind) => box.commerce.writes.filter((w) => w.kind === kind);
const erpCall = (action, method, path) =>
  box.erp.call(action, { method, path });

/** The store filled into the ERP, order 55 sent, confirmed, shipped and invoiced there. */
async function invoicedOrder() {
  await fillErp(box.commerce.lib, erp, "Box");
  await orderCreated.main(
    box.commerce.events.orderSaved(ORDER_ID, { isNew: true }),
  );
  const { number } = splitExtOrderId(
    box.commerce.db.orders.get(ORDER_ID).ext_order_id,
  );
  await erpCall("orders", "POST", `/${number}/confirm`);
  await box.erp.call("orders", {
    body: { status: "shipped" },
    method: "POST",
    path: `/${number}/status`,
  });
  await erpCall("orders", "POST", `/${number}/invoice`);
  await deliverErpEvents();
  expect(writesOf("invoice")).toHaveLength(1);
  return number;
}

beforeEach(() => {
  box.commerce.reset();
  box.erp.reset();
  box.state.reset();
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
});

describe("Pair in a box: a return, Commerce → ERP → Commerce", () => {
  test("A return of 3 trousers becomes one ERP return order; received and credited there, it ends as one Commerce credit memo of that line and a closed return", async () => {
    const number = await invoicedOrder();
    const returnId = box.commerce.adminCreateReturn(ORDER_ID, [
      { order_item_id: 1, qty: 3 },
    ]);

    // Commerce saved the return: the ERP gets a return order on its own sales order.
    const sent = await returnSaved.main(
      box.commerce.events.returnSaved(returnId),
    );
    expect(sent).toMatchObject({ statusCode: 200 });
    const [returnOrder] = (await erpCall("returns", "GET")).data.items;
    expect(returnOrder).toMatchObject({
      commerceReturnId: String(returnId),
      lines: [{ commerceItemId: 1, qty: 3, sku: "A1" }],
      orderNumber: number,
      status: "open",
    });
    let rma = box.commerce.db.returns.get(returnId);
    expect([
      rma.status,
      rma.items[0].status,
      rma.items[0].qty_authorized,
    ]).toEqual(["authorized", "authorized", 3]);
    expect(rma.increment_id).toBe(String(returnId).padStart(9, "0"));

    // The integration's own write saved the return again: nothing new is sent or written.
    const again = await returnSaved.main(
      box.commerce.events.returnSaved(returnId),
    );
    expect(again.statusCode).toBe(200);
    expect((await erpCall("returns", "GET")).data.items).toHaveLength(1);
    expect(writesOf("updateReturn")).toHaveLength(1);

    // The goods are back in the ERP: Commerce's return reads received.
    await erpCall("returns", "POST", `/${returnOrder.number}/receive`);
    const received = await deliverErpEvents();
    expect(
      received.find((d) => d.event === "be-observer.rma_status_update")?.status,
    ).toBe(200);
    rma = box.commerce.db.returns.get(returnId);
    expect([
      rma.status,
      rma.items[0].status,
      rma.items[0].qty_returned,
    ]).toEqual(["received", "received", 3]);

    // The ERP credits the return: one Commerce credit memo of that line, 3 units.
    await erpCall("returns", "POST", `/${returnOrder.number}/credit-memo`);
    const [credited] = await deliverErpEvents();
    expect(credited.status).toBe(200);
    const memo = (await erpCall("returns", "GET", `/${returnOrder.number}`))
      .data.creditMemo;
    expect(writesOf("refund")).toEqual([
      {
        comment: `Credited in the ERP (credit memo ${memo.number})`,
        items: [{ order_item_id: 1, qty: 3 }],
        kind: "refund",
        orderId: String(ORDER_ID),
      },
    ]);
    rma = box.commerce.db.returns.get(returnId);
    expect([
      rma.status,
      rma.items[0].status,
      rma.items[0].qty_approved,
    ]).toEqual(["processed_closed", "approved", 3]);
    expect(rma.comments.map((c) => c.comment)).toEqual([
      `Sent to the ERP as return order ${returnOrder.number}`,
      `Goods received by the ERP (return order ${returnOrder.number})`,
      `Credited by the ERP (credit memo ${memo.number})`,
    ]);

    // I/O Events delivers the credit memo event again: nothing is credited twice.
    const redelivered = await erpCreditMemo.main(credited.params);
    expect(redelivered.statusCode).toBe(200);
    expect(writesOf("refund")).toHaveLength(1);
    expect(box.commerce.db.creditMemos).toHaveLength(1);
  });

  test("The ERP credits a whole invoice with no return: Commerce credits every line once", async () => {
    const number = await invoicedOrder();

    await erpCall("orders", "POST", `/${number}/credit-memo`);
    const [credited] = await deliverErpEvents();

    expect(credited.status).toBe(200);
    expect(writesOf("refund").map((w) => w.items)).toEqual([
      [
        { order_item_id: 1, qty: 12 },
        { order_item_id: 2, qty: 4 },
      ],
    ]);
    expect((await erpCreditMemo.main(credited.params)).statusCode).toBe(200);
    expect(writesOf("refund")).toHaveLength(1);
  });
});
