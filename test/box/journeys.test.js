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
    orders_hold_offline: true,
    orders_send: true,
    orders_status_on_confirm: true,
    pricing_contract_prices: true,
    pricing_discount_ceiling: true,
  },
  settingsFor: async () => ({
    orders_hold_offline: true,
    orders_send: true,
    orders_status_on_confirm: true,
    pricing_contract_prices: true,
    pricing_discount_ceiling: true,
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
      quote: (params, body) =>
        call("pricing", { body, method: "POST", params, path: "/quote" }),
      reportSync: (params, step) =>
        call("admin", { body: step, method: "POST", params, path: "/sync" }),
      settings: (params) => call("settings", { params }),
      wipe: (params) =>
        call("admin", { method: "POST", params, path: "/wipe" }),
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
import * as ledger from "#lib/ledger";
import { mirror } from "#lib/mirror";
import { refreshStock } from "#lib/stock-refresh";
import * as snapshot from "#lib/stock-snapshot";
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
import * as erpStock from "#src/stock/external/updated/index";

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
/* The mirror's readers as a plain object: a mocked module namespace throws on a property
   it does not export, and the mirror probes for the optional readers. */
const readers = { ...box.commerce.lib, websiteSettings: async () => ({}) };
const TEN_DIGITS = /^\d{10}$/u;
const PREFIXED = /^ERP-\d{10}$/u;
const RECEIVED_FROM_COMMERCE = /received from Commerce/u;
const ON_CREDIT_HOLD =
  /^On credit hold in the ERP .*Credit limit 1,000\.00 exceeded/u;
const erpOrder = async (number) => (await erp.order({}, number)).data;

/** The store mirrored into the ERP and the first Commerce order sent, as a demo starts. */
async function seeded() {
  await mirror({}, readers, erp, "Box");
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
  snapshot.resetSnapshotClient(box.state);
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

  test("Order, ERP → Commerce: confirming in the ERP leaves a note and moves the order to Processing", async () => {
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
      status: "processing",
    });
    expect(box.commerce.db.orders.get(55).status).toBe("processing");
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

  test("Credit, ERP → Commerce: an over-limit order is held in the ERP and put On Hold in Commerce; release takes it off; reject takes it off and cancels", async () => {
    await mirror({}, readers, erp, "Box");
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

  test("Inventory, Commerce → ERP: a source quantity edited in Commerce reaches the ERP within the minute, and the ERP's own write is not echoed", async () => {
    await seeded();
    expect((await refreshStock({}, readers, erp, snapshot)).seeded).toBe(true);
    box.commerce.adminSetSourceItem("A1", "east", 3);
    const moved = await refreshStock({}, readers, erp, snapshot);
    expect(moved).toEqual({ changed: ["A1"], seeded: false, sent: 1 });
    const product = (await box.erp.call("products", { path: "/A1" })).data;
    expect(product.warehouses.find((w) => w.code === "east").quantity).toBe(3);
    // The ERP writes stock into Commerce; the refresh must not read it back as a Commerce change.
    await box.erp.call("products", {
      body: { warehouses: [{ code: "default", quantity: 41 }] },
      method: "PATCH",
      path: "/A1",
    });
    await deliverErpEvents();
    expect(box.commerce.db.sourceItems.get("A1|default")).toBe(41);
    expect(await refreshStock({}, readers, erp, snapshot)).toEqual({
      changed: [],
      seeded: false,
      sent: 0,
    });
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

  test("Buying organization and credit, ERP → Commerce: a block and a credit limit set in the ERP reach the company, ledgered, and come back on reset", async () => {
    await seeded();
    await box.erp.call("partners", {
      body: { blocking: "all", creditLimit: 250 },
      method: "PATCH",
      path: "/C7",
    });
    await deliverErpEvents();
    expect(box.commerce.db.companies.get(7).status).toBe(3);
    expect(box.commerce.db.credits.get(7).credit_limit).toBe(250);
    await detach({}, { commerce: commerceLib, erp, ledger });
    expect(box.commerce.db.companies.get(7).status).toBe(1);
    expect(box.commerce.db.credits.get(7).credit_limit).toBe(1000);
  });
});
