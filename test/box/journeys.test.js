/*
 * Pair-in-a-box (AB-26c): the ERP runs in this process behind the integration's ERP
 * client, and a fake Commerce that records every write stands in front. Each journey is
 * one row of the entity matrix, both directions, and asks the two questions the sync has
 * to answer: did the change arrive, and did nothing come back twice.
 *
 * The ERP's events are delivered here by hand (deliverErpEvents), the way I/O Events
 * would, to the handler each event name maps to.
 */
const box = await vi.hoisted(async () => {
  const { createFakeCommerce } = await import("./fake-commerce.js");
  const { startErp } = await import("./erp-in-process.js");
  const { fakeState } = await import("./state.js");
  const commerce = createFakeCommerce();
  const erpBox = startErp();
  const state = fakeState();
  return { commerce, erp: erpBox, state };
});

vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: async () => box.state },
}));
vi.mock("#lib/settings", () => ({
  SETTING_DEFAULTS: {
    orders_confirm_status: "",
    orders_hold_offline: true,
    orders_send: true,
  },
  settingsFor: async () => ({
    orders_confirm_status: "",
    orders_hold_offline: true,
    orders_send: true,
  }),
  websiteSettings: async () => ({ structure_sales_org: "1000" }),
}));
vi.mock("#lib/erp", () => {
  const { call } = box.erp;
  const post = (action, path, body) => (params) =>
    call(action, { body, method: "POST", params, path });
  return {
    erp: {
      createOrder: (params, order) =>
        call("orders", { body: order, method: "POST", params }),
      deleteProduct: (params, sku, body) =>
        call("products", {
          body,
          method: "DELETE",
          params,
          path: `/${encodeURIComponent(sku)}`,
        }),
      fromCommerce: {
        cancel: (params, number, body) =>
          post("orders", `/${number}/cancel`, body)(params),
        hold: (params, number, body) =>
          post("orders", `/${number}/credit/hold`, body)(params),
        invoice: (params, number, body) =>
          post("orders", `/${number}/commerce-invoice`, body)(params),
        release: (params, number, body) =>
          post("orders", `/${number}/credit/release`, body)(params),
        ship: (params, number, body) =>
          post("orders", `/${number}/commerce-shipment`, body)(params),
      },
      health: (params) => call("health", { params }),
      importRecords: (params, body) =>
        call("admin", { body, method: "POST", params, path: "/import" }),
      listOrders: (params) => call("orders", { params }),
      order: (params, number) => call("orders", { params, path: `/${number}` }),
      ordersByReference: (params, reference) =>
        call("orders", {
          params,
          path: `?reference=${encodeURIComponent(reference)}`,
        }),
      product: (params, sku) =>
        call("products", { params, path: `/${encodeURIComponent(sku)}` }),
      settings: (params) => call("settings", { params }),
    },
    erpAuthHeaders: async () => ({}),
    erpBaseUrl: () => "in-process",
    erpRequest: async () => ({ data: {}, ok: false, status: 500 }),
    resetErpTokenCache: () => undefined,
  };
});
vi.mock("#lib/commerce", () => box.commerce.lib);
vi.mock("#lib/commerce-before", () => box.commerce.before);
vi.mock("#src/order/commerce-order-api-client", () => box.commerce.orderClient);
vi.mock(
  "#src/order/commerce-shipment-api-client",
  () => box.commerce.shipmentClient,
);
vi.mock("#src/stock/commerce-stock-api-client", () => box.commerce.stockClient);
vi.mock(
  "#src/product/commerce-product-api-client",
  () => box.commerce.productClient,
);

import * as commerceLib from "#lib/commerce";
import { detach } from "#lib/detach";
import { erp } from "#lib/erp";
import * as keyMap from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { splitExtOrderId } from "#lib/structure";
import * as creditUpdated from "#src/company/external/credit-updated/index";
import * as statusUpdated from "#src/company/external/status-updated/index";
import * as orderChanged from "#src/order/commerce/changed/index";
import * as orderCreated from "#src/order/commerce/created/index";
import * as orderInvoiced from "#src/order/commerce/invoiced/index";
import * as orderShipped from "#src/order/commerce/shipped/index";
import * as erpCancelled from "#src/order/external/cancelled/index";
import * as erpHold from "#src/order/external/hold/index";
import * as erpInvoiceCreated from "#src/order/external/invoice-created/index";
import * as erpShipmentCreated from "#src/order/external/shipment-created/index";
import * as erpStatus from "#src/order/external/updated/index";
import * as productDeleted from "#src/product/commerce/deleted/index";
import * as erpProduct from "#src/product/external/updated/index";
import * as stockSaved from "#src/stock/commerce/updated/index";
import * as erpStock from "#src/stock/external/updated/index";

import { fillErp } from "./fill-erp.js";

/** Which handler each ERP event reaches (app.commerce.config.ts, eventing.external). */
const ERP_HANDLERS = {
  "be-observer.catalog_product_update": erpProduct,
  "be-observer.catalog_stock_update": erpStock,
  "be-observer.company_credit_update": creditUpdated,
  "be-observer.company_status_update": statusUpdated,
  "be-observer.sales_order_cancel": erpCancelled,
  "be-observer.sales_order_hold": erpHold,
  "be-observer.sales_order_invoice_create": erpInvoiceCreated,
  "be-observer.sales_order_shipment_create": erpShipmentCreated,
  "be-observer.sales_order_status_update": erpStatus,
};

/** Deliver every pending ERP event to its handler, as I/O Events would; answers the handlers' responses. */
async function deliverErpEvents() {
  const responses = [];
  for (const entry of await box.erp.pendingEvents()) {
    const handler = ERP_HANDLERS[entry.event];
    if (!handler) {
      throw new Error(`no handler for ERP event ${entry.event}`);
    }
    // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as they were raised
    const res = await handler.main({
      data: entry.value,
      id: entry._id,
      type: entry.event,
    });
    responses.push({
      event: entry.event,
      statusCode: res.statusCode ?? res.error?.statusCode,
    });
    await box.erp.markDelivered(entry);
  }
  return responses;
}

const writesOf = (kind) => box.commerce.writes.filter((w) => w.kind === kind);
/* The fake Commerce's reads, for the box's stand-in for Demo Builder's fill. */
const readers = box.commerce.lib;
const TEN_DIGITS = /^\d{10}$/u;
const PREFIXED = /^ERP-\d{10}$/u;
const RECEIVED_FROM_COMMERCE = /received from Commerce/u;
const ON_CREDIT_HOLD =
  /^On credit hold in the ERP .*Credit limit 1,000\.00 exceeded/u;
const erpOrder = async (number) => (await erp.order({}, number)).data;

/** The store filled into the ERP and the first Commerce order sent, as a demo starts. */
async function seeded() {
  await fillErp(readers, erp, "Box");
  const res = await orderCreated.main(
    box.commerce.events.orderSaved(55, { isNew: true }),
  );
  expect(res.statusCode).toBe(200);
  // Written back with the pair's prefix (rule M4); no ERP name in the box, so ERP-.
  const ext = box.commerce.db.orders.get(55).ext_order_id;
  expect(ext).toMatch(PREFIXED);
  const { number } = splitExtOrderId(ext);
  expect(number).toMatch(TEN_DIGITS);
  return number;
}

beforeEach(() => {
  box.commerce.reset();
  box.erp.reset();
  box.state.reset();
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
});

describe("Pair in a box: the entity matrix, both directions", () => {
  test("Order, Commerce → ERP: a new order becomes an ERP sales order and its number is written back once", async () => {
    const number = await seeded();
    const order = await erpOrder(number);
    expect(order.commerceIncrementId).toBe("000000042");
    expect(order.lines.map((l) => [l.sku, l.qty, l.commerceItemId])).toEqual([
      ["A1", 12, 1],
      ["B2", 4, 2],
    ]);
    expect(order.partnerId).toBe("C7");
    expect(writesOf("setExtOrderId")).toEqual([
      { kind: "setExtOrderId", orderId: "55", value: `ERP-${number}` },
    ]);
    // The write-back saves the order again; that save is not a new order and creates nothing.
    const again = await orderCreated.main(box.commerce.events.orderSaved(55));
    expect(again.statusCode).toBe(200);
    expect((await erp.listOrders({})).data.items).toHaveLength(1);
    expect(writesOf("setExtOrderId")).toHaveLength(1);
  });

  test("Order, ERP → Commerce: confirming in the ERP leaves a note; the order stays Pending (Commerce moves it only on invoice or shipment)", async () => {
    const number = await seeded();
    expect(
      (
        await box.erp.call("orders", {
          method: "POST",
          path: `/${number}/confirm`,
        })
      ).ok,
    ).toBe(true);
    const delivered = await deliverErpEvents();
    expect(delivered).toEqual([
      { event: "be-observer.sales_order_status_update", statusCode: 200 },
    ]);
    // The order send left the first note ("Created in the ERP as sales order …"); the confirm adds the second.
    expect(writesOf("comment").at(-1)).toEqual({
      comment: `Order confirmed in the ERP (ERP sales order ${number})`,
      kind: "comment",
      orderId: "55",
      status: undefined,
    });
    expect(box.commerce.db.orders.get(55).status).toBe("pending");
  });

  test("Shipment, ERP → Commerce → ERP: the ERP ships, Commerce records one shipment from that source, and Commerce's event back is matched, not shipped twice", async () => {
    const number = await seeded();
    await box.erp.call("orders", {
      method: "POST",
      path: `/${number}/confirm`,
    });
    const created = await box.erp.call("orders", {
      body: { lines: [{ item: 10, qty: 5 }], warehouse: "east" },
      method: "POST",
      path: `/${number}/shipments`,
    });
    const shipmentNumber = created.data.shipments[0].number;
    await box.erp.call("orders", {
      method: "POST",
      path: `/${number}/shipments/${shipmentNumber}/post`,
    });
    await deliverErpEvents();
    expect(writesOf("ship")).toEqual([
      { kind: "ship", orderId: "55", shipmentId: 900, sourceCode: "east" },
    ]);
    expect(box.commerce.db.sourceItems.get("A1|east")).toBe(15);
    // Commerce's shipment event for the shipment the integration just made.
    const back = await orderShipped.main(
      box.commerce.events.shipmentSaved(900),
    );
    expect(back.statusCode).toBe(200);
    const order = await erpOrder(number);
    expect(order.shipments).toHaveLength(1);
    expect(order.shipments[0].commerceShipmentId).toBe("900");
    expect(order.lines.map((l) => l.shippedQty)).toEqual([5, 0]);
    expect(writesOf("ship")).toHaveLength(1);
    expect(await box.erp.pendingEvents()).toEqual([]);
  });

  test("Shipment, Commerce → ERP: a shipment made in Commerce Admin is recorded on the ERP order and nothing ships again in Commerce", async () => {
    const number = await seeded();
    const shipmentId = box.commerce.adminShip(
      55,
      [
        { order_item_id: 1, qty: 12 },
        { order_item_id: 2, qty: 4 },
      ],
      "default",
    );
    const res = await orderShipped.main(
      box.commerce.events.shipmentSaved(shipmentId),
    );
    expect(res.statusCode).toBe(200);
    const order = await erpOrder(number);
    expect(order.header).toBe("confirmed");
    expect(
      order.shipments.map((s) => [s.status, s.warehouse, s.commerceShipmentId]),
    ).toEqual([["posted", "default", String(shipmentId)]]);
    expect(order.status).toBe("shipped");
    expect(await box.erp.pendingEvents()).toEqual([]);
    expect(writesOf("ship")).toHaveLength(1);
    const journal = (await box.erp.call("events")).data.items.filter(
      (e) => e.direction === "in",
    );
    expect(journal.some((e) => RECEIVED_FROM_COMMERCE.test(e.summary))).toBe(
      true,
    );
  });

  test("Invoice, both ways: the ERP's invoice reaches Commerce once, and Commerce's own invoice event does not invoice the ERP twice", async () => {
    const number = await seeded();
    await box.erp.call("orders", {
      method: "POST",
      path: `/${number}/confirm`,
    });
    await box.erp.call("orders", {
      body: { status: "shipped" },
      method: "POST",
      path: `/${number}/status`,
    });
    await box.erp.call("orders", {
      method: "POST",
      path: `/${number}/invoice`,
    });
    await deliverErpEvents();
    expect(writesOf("invoice")).toHaveLength(1);
    const [{ invoiceId }] = writesOf("invoice");
    const back = await orderInvoiced.main(
      box.commerce.events.invoiceSaved(invoiceId),
    );
    expect(back.statusCode).toBe(200);
    const order = await erpOrder(number);
    expect(order.invoice.number).toMatch(TEN_DIGITS);
    expect(writesOf("invoice")).toHaveLength(1);
  });

  test("Customer, the key map: a buyer's company goes to the ERP customer the map pairs it with, not one the ERP matches itself", async () => {
    await fillErp(readers, erp, "Box");
    await erp.importRecords(
      {},
      { partners: [{ id: "C999", name: "Northwind (new account)" }] },
    );
    await keyMap.pairCustomer("7", "C999");
    box.commerce.db.customers.set(3, { company_id: 7, id: 3 });
    box.commerce.db.orders.get(55).customer_id = 3;
    await orderCreated.main(
      box.commerce.events.orderSaved(55, { isNew: true }),
    );
    const { number } = splitExtOrderId(
      box.commerce.db.orders.get(55).ext_order_id,
    );
    // The ERP still holds company 7's id on C7, so without the map it would pick C7.
    expect((await erpOrder(number)).partnerId).toBe("C999");
  });

  test("Credit, ERP → Commerce: an over-limit order is held in the ERP and put On Hold in Commerce; release takes it off; reject takes it off and cancels", async () => {
    await fillErp(readers, erp, "Box");
    box.commerce.db.orders.get(55).base_grand_total = 5000;
    box.commerce.db.orders.get(55).items[0].base_price = 400;
    await orderCreated.main(
      box.commerce.events.orderSaved(55, { isNew: true }),
    );
    const { number } = splitExtOrderId(
      box.commerce.db.orders.get(55).ext_order_id,
    );
    expect((await erpOrder(number)).creditStatus).toBe("held");
    let delivered = await deliverErpEvents();
    expect(delivered).toEqual([
      { event: "be-observer.sales_order_hold", statusCode: 200 },
    ]);
    expect(box.commerce.db.orders.get(55).state).toBe("holded");
    expect(writesOf("comment").at(-1).comment).toMatch(ON_CREDIT_HOLD);
    await box.erp.call("orders", {
      method: "POST",
      path: `/${number}/credit/release`,
    });
    delivered = await deliverErpEvents();
    expect(delivered).toEqual([
      { event: "be-observer.sales_order_hold", statusCode: 200 },
    ]);
    expect(box.commerce.db.orders.get(55).state).toBe("new");
    // A second held order, rejected: Commerce takes it off hold, then cancels.
    box.commerce.db.orders.set(56, {
      ...box.commerce.db.orders.get(55),
      entity_id: 56,
      ext_order_id: null,
      increment_id: "000000043",
      state: "new",
    });
    await orderCreated.main(
      box.commerce.events.orderSaved(56, { isNew: true }),
    );
    const second = splitExtOrderId(
      box.commerce.db.orders.get(56).ext_order_id,
    ).number;
    await deliverErpEvents();
    expect(box.commerce.db.orders.get(56).state).toBe("holded");
    await box.erp.call("orders", {
      method: "POST",
      path: `/${second}/credit/reject`,
    });
    await deliverErpEvents();
    expect(box.commerce.db.orders.get(56).state).toBe("canceled");
    expect(writesOf("unhold").map((w) => w.orderId)).toEqual(["55", "56"]);
  });

  test("Order, Commerce → ERP: a cancellation and a hold made in Commerce Admin reach the ERP, and are not echoed back", async () => {
    const number = await seeded();
    await box.commerce.adminHold(55);
    expect(
      (await orderChanged.main(box.commerce.events.orderSaved(55))).statusCode,
    ).toBe(200);
    expect((await erpOrder(number)).creditStatus).toBe("held");
    expect((await erpOrder(number)).creditReason).toBe(
      "Put on hold in Commerce",
    );
    await box.commerce.orderClient.unholdOrder({}, 55);
    expect(
      (await orderChanged.main(box.commerce.events.orderSaved(55))).statusCode,
    ).toBe(200);
    expect((await erpOrder(number)).creditStatus).toBe("released");
    await box.commerce.adminCancel(55);
    expect(
      (await orderChanged.main(box.commerce.events.orderSaved(55))).statusCode,
    ).toBe(200);
    expect((await erpOrder(number)).status).toBe("cancelled");
    expect(await box.erp.pendingEvents()).toEqual([]);
    expect(writesOf("cancel")).toHaveLength(1);
  });

  test("Sellable item and inventory, ERP → Commerce, ledgered; reset puts every write back and clears the ERP numbers", async () => {
    const number = await seeded();
    await box.erp.call("products", {
      body: {
        listPrice: 12,
        name: "Trouser (ERP)",
        warehouses: [{ code: "east", quantity: 7 }],
      },
      method: "PATCH",
      path: "/A1",
    });
    await deliverErpEvents();
    expect(box.commerce.db.products.get("A1").price).toBe(12);
    expect(box.commerce.db.sourceItems.get("A1|east")).toBe(7);
    const entries = await ledger.readLedger();
    expect(
      entries.map((e) => [e.kind, e.id, e.field, e.before, e.after]),
    ).toEqual(
      expect.arrayContaining([
        ["product", "A1", "price", 10, 12],
        ["product", "A1", "name", "Trouser", "Trouser (ERP)"],
        ["product", "A1", "stock", 20, 7],
      ]),
    );
    const result = await detach({}, { commerce: commerceLib, erp, ledger });
    expect(result.reverted.failed).toEqual([]);
    expect(box.commerce.db.products.get("A1").price).toBe(10);
    expect(box.commerce.db.products.get("A1").name).toBe("Trouser");
    expect(box.commerce.db.sourceItems.get("A1|east")).toBe(20);
    expect(box.commerce.db.orders.get(55).ext_order_id).toBe("");
    expect(await ledger.readLedger()).toEqual([]);
    expect(number).toBeTruthy();
  });

  test("Inventory, Commerce → ERP: a stock item save reaches the ERP with the quantity at every source, not only the default", async () => {
    await seeded();
    box.commerce.adminSetSourceItem("A1", "east", 3);
    box.commerce.adminSetSourceItem("A1", "default", 9);
    const res = await stockSaved.main(box.commerce.events.stockItemSaved("A1"));
    expect(res.statusCode).toBe(200);
    const product = (await box.erp.call("products", { path: "/A1" })).data;
    const quantities = Object.fromEntries(
      product.warehouses.map((w) => [w.code, w.quantity]),
    );
    expect(quantities).toMatchObject({ default: 9, east: 3 });
  });

  test("Sellable item, Commerce → ERP: a product deleted in Commerce leaves the ERP", async () => {
    await seeded();
    box.commerce.db.products.delete("B2");
    const res = await productDeleted.main({
      data: { value: { id: 102, sku: "B2" } },
    });
    expect(res.statusCode).toBe(200);
    expect((await box.erp.call("products", { path: "/B2" })).status).toBe(404);
    expect(
      (await productDeleted.main({ data: { value: { id: 102, sku: "B2" } } }))
        .statusCode,
    ).toBe(200);
  });

  // Each ERP for itself, one ERP too (owner, 2026-09-28): the ERP's block holds the company's
  // orders and never switches the Commerce company off; the unblock releases them.
  test("Buying organization and credit, ERP → Commerce: a block holds the company's open order and leaves the company active; the unblock releases it; a credit limit reaches the company, ledgered, and comes back on reset", async () => {
    await seeded();
    await box.erp.call("partners", {
      body: { blocking: "all", creditLimit: 250 },
      method: "PATCH",
      path: "/C7",
    });
    await deliverErpEvents();
    expect(box.commerce.db.companies.get(7).status).toBe(1);
    expect(box.commerce.db.orders.get(55).state).toBe("holded");
    expect(box.commerce.db.credits.get(7).credit_limit).toBe(250);
    await box.erp.call("partners", {
      body: { blocking: "open" },
      method: "PATCH",
      path: "/C7",
    });
    await deliverErpEvents();
    expect(box.commerce.db.orders.get(55).state).not.toBe("holded");
    expect(box.commerce.db.companies.get(7).status).toBe(1);
    await detach({}, { commerce: commerceLib, erp, ledger });
    expect(box.commerce.db.credits.get(7).credit_limit).toBe(1000);
  });
});
