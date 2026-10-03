/*
 * Pair-in-a-box (AB-26c): the ERP runs in this process behind the integration's ERP
 * client, and a fake Commerce that records every write stands in front. Each journey is
 * one row of the entity matrix, both directions, and asks the two questions the sync has
 * to answer: did the change arrive, and did nothing come back twice.
 *
 * The ERP's events are delivered here by hand (deliverErpEvents), the way production does:
 * the ERP's own CloudEvent, through the ingestion webhook's translation (AB-26y step 6), to
 * the handler each translated event reaches.
 */
const box = await vi.hoisted(async () => {
  const { createFakeCommerce } = await import("./fake-commerce.js");
  const { startErp } = await import("./erp-in-process.js");
  const { fakeState } = await import("./state.js");
  const { erpClientModule, settingsModule } = await import("./box-modules.js");
  const commerce = createFakeCommerce();
  const erpBox = startErp();
  const state = fakeState();
  return {
    commerce,
    erp: erpBox,
    erpClient: erpClientModule(erpBox.call),
    settings: settingsModule(),
    state,
  };
});

vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: async () => box.state },
}));
vi.mock("#lib/settings", () => box.settings);
vi.mock("#lib/erp", () => box.erpClient);
vi.mock("#lib/commerce", () => box.commerce.lib);
vi.mock("#lib/commerce-before", () => box.commerce.before);
vi.mock("#lib/commerce-tier-prices", () => box.commerce.tierPrices);
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
import * as tierPrices from "#lib/commerce-tier-prices";
import { contractPriceDeps } from "#lib/contract-price-deps";
import { publishErpPrices } from "#lib/contract-prices";
import { detach } from "#lib/detach";
import { erp } from "#lib/erp";
import { readHistory } from "#lib/history";
import * as keyMap from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { splitExtOrderId } from "#lib/structure";
import * as erpPrices from "#src/erp/prices/index";
import * as orderChanged from "#src/order/commerce/changed/index";
import * as orderCreated from "#src/order/commerce/created/index";
import * as orderInvoiced from "#src/order/commerce/invoiced/index";
import * as orderShipped from "#src/order/commerce/shipped/index";
import * as productDeleted from "#src/product/commerce/deleted/index";
import * as productSaved from "#src/product/commerce/updated/index";
import * as stockSaved from "#src/stock/commerce/updated/index";

import { deliverErpEvents as deliverThrough } from "./deliver-erp-events.js";
import { fillErp } from "./fill-erp.js";

/**
 * Deliver every pending ERP event through the ingestion webhook's translation, as production
 * does (deliver-erp-events.js); answers each handler run as `{ event, statusCode }`.
 */
async function deliverErpEvents() {
  return (await deliverThrough(box.erp)).map(({ event, statusCode }) => ({
    event,
    statusCode,
  }));
}

const writesOf = (kind) => box.commerce.writes.filter((w) => w.kind === kind);
/* The fake Commerce's reads, for the box's stand-in for Demo Builder's fill. */
const readers = box.commerce.lib;
const TEN_DIGITS = /^\d{10}$/u;
const PREFIXED = /^ERP-\d{10}$/u;
const POSTED_FROM_COMMERCE = /^Goods issue posted from Adobe Commerce/u;
const ON_CREDIT_HOLD =
  /^On credit hold in the ERP .*Credit limit USD 1,000\.00 exceeded/u;
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
    // The ERP keeps Commerce's numbers as the customer's references (its contract version 16).
    expect(order.purchaseOrderByCustomer).toBe("000000042");
    expect(
      order.lines.map((l) => [l.sku, l.qty, l.customerLineReference]),
    ).toEqual([
      ["A1", 12, "1"],
      ["B2", 4, "2"],
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
    expect(order.shipments[0].externalReference).toBe("900");
    expect(order.lines.map((l) => l.shippedQty)).toEqual([5, 0]);
    expect(writesOf("ship")).toHaveLength(1);
    expect(await box.erp.pendingEvents()).toEqual([]);
  });

  test("Shipment, Commerce → ERP → Commerce: a shipment made in Commerce Admin is recorded on the ERP order, the ERP's goods issue for it is recognised as the echo, and nothing ships again in Commerce", async () => {
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
      order.shipments.map((s) => [s.status, s.warehouse, s.externalReference]),
    ).toEqual([["posted", "default", String(shipmentId)]]);
    expect(order.status).toBe("shipped");
    // Contract version 19: the ERP raises its goods issue for it, as for its own.
    expect((await box.erp.pendingEvents()).map((e) => e.type)).toEqual([
      "OutboundDelivery.GoodsIssueStatusChanged",
    ]);
    // Delivered, it is this integration's own change coming back: no handler runs.
    expect(await deliverErpEvents()).toEqual([]);
    expect(await box.erp.pendingEvents()).toEqual([]);
    expect(writesOf("ship")).toHaveLength(1);
    const journal = (await box.erp.call("events")).data.items.filter(
      (e) => e.direction === "in",
    );
    expect(journal.some((e) => POSTED_FROM_COMMERCE.test(e.summary))).toBe(
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

  test("Order, Commerce → ERP: a cancellation and a hold made in Commerce Admin reach the ERP; the ERP raises each, and each echo is recognised and changes nothing in Commerce", async () => {
    const number = await seeded();
    const comments = writesOf("comment").length;
    /** The ERP's events since the last move: raised, delivered, and every one an echo. */
    const echoesOnly = async (types) => {
      expect((await box.erp.pendingEvents()).map((e) => e.type)).toEqual(types);
      expect(await deliverErpEvents()).toEqual([]);
      expect(await box.erp.pendingEvents()).toEqual([]);
    };
    await box.commerce.adminHold(55);
    expect(
      (await orderChanged.main(box.commerce.events.orderSaved(55))).statusCode,
    ).toBe(200);
    expect((await erpOrder(number)).creditStatus).toBe("held");
    expect((await erpOrder(number)).creditReason).toBe(
      "Put on hold in the web shop",
    );
    await echoesOnly(["SalesOrder.Changed"]);
    await box.commerce.orderClient.unholdOrder({}, 55);
    expect(
      (await orderChanged.main(box.commerce.events.orderSaved(55))).statusCode,
    ).toBe(200);
    expect((await erpOrder(number)).creditStatus).toBe("released");
    await echoesOnly(["SalesOrder.Changed"]);
    await box.commerce.adminCancel(55);
    expect(
      (await orderChanged.main(box.commerce.events.orderSaved(55))).statusCode,
    ).toBe(200);
    expect((await erpOrder(number)).status).toBe("canceled");
    await echoesOnly(["SalesOrder.Changed"]);
    // Commerce's own three moves, once each, and no note claiming the ERP did them.
    expect(
      ["hold", "unhold", "cancel"].map((kind) => writesOf(kind).length),
    ).toEqual([1, 1, 1]);
    expect(writesOf("comment")).toHaveLength(comments);
  });

  test("Shipment and invoice, Commerce → ERP → Commerce: two equal shipments and an invoice made in Commerce Admin are each recognised when the ERP raises them; the ERP's own shipment afterwards still reaches Commerce", async () => {
    const number = await seeded();
    const shipped = async (qty) => {
      const id = box.commerce.adminShip(55, [{ order_item_id: 1, qty }]);
      expect(
        (await orderShipped.main(box.commerce.events.shipmentSaved(id)))
          .statusCode,
      ).toBe(200);
    };
    // Two shipments with the same lines: two echoes, both recognised.
    await shipped(4);
    await shipped(4);
    expect((await box.erp.pendingEvents()).map((e) => e.type)).toEqual([
      "OutboundDelivery.GoodsIssueStatusChanged",
      "OutboundDelivery.GoodsIssueStatusChanged",
    ]);
    expect(await deliverErpEvents()).toEqual([]);
    expect(writesOf("ship")).toHaveLength(2);
    // The ERP ships the rest itself: a change of its own, which reaches Commerce.
    await box.erp.call("orders", {
      body: { status: "shipped" },
      method: "POST",
      path: `/${number}/status`,
    });
    expect(await deliverErpEvents()).toEqual([
      { event: "be-observer.sales_order_shipment_create", statusCode: 200 },
    ]);
    expect(writesOf("ship")).toHaveLength(3);
    // An invoice made in Commerce Admin: the ERP invoices too, and its invoice is the echo.
    const invoiceId = await box.commerce.adminInvoice(55);
    expect(
      (await orderInvoiced.main(box.commerce.events.invoiceSaved(invoiceId)))
        .statusCode,
    ).toBe(200);
    expect((await erpOrder(number)).invoice.externalReference).toBe(
      String(invoiceId),
    );
    expect((await box.erp.pendingEvents()).map((e) => e.type)).toEqual([
      "BillingDocument.Created",
    ]);
    expect(await deliverErpEvents()).toEqual([]);
    expect(writesOf("invoice")).toHaveLength(1);
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

  // Justrite, 2026-10-02 (AB-62): Commerce raised two save events for the first rename, the
  // second after the ERP had renamed back, and it put the first name back into the ERP.
  test("Sellable item, ERP → Commerce → ERP: a rename, its echo, a rename back and the first rename's late second echo leave both systems on the second name; a rename made in Commerce still reaches the ERP", async () => {
    await seeded();
    const rename = (name) =>
      box.erp.call("products", {
        body: { name },
        method: "PATCH",
        path: "/A1",
      });
    const erpName = async () =>
      (await box.erp.call("products", { path: "/A1" })).data.name;

    await rename("Trouser (test)");
    await deliverErpEvents();
    expect(box.commerce.db.products.get("A1").name).toBe("Trouser (test)");
    // Commerce raises more than one save event for the one write; each carries the first name.
    const firstEcho = box.commerce.events.productSaved("A1");
    const lateEcho = box.commerce.events.productSaved("A1");
    expect((await productSaved.main(firstEcho)).statusCode).toBe(200);

    await rename("Trouser");
    // The late echo arrives before the ERP's second event is handled, as it did live.
    expect((await productSaved.main(lateEcho)).statusCode).toBe(200);
    expect(await erpName()).toBe("Trouser");
    await deliverErpEvents();
    expect(box.commerce.db.products.get("A1").name).toBe("Trouser");
    expect(
      (await productSaved.main(box.commerce.events.productSaved("A1")))
        .statusCode,
    ).toBe(200);
    expect(await erpName()).toBe("Trouser");
    expect(box.commerce.db.products.get("A1").name).toBe("Trouser");
    // The ERP was told nothing by Commerce: none of the four saves was a change made there.
    const importsFromCommerce = async () =>
      (await box.erp.cols.events.find({}).toArray()).filter(
        (e) => e.direction === "in" && e.origin?.document === "product A1",
      ).length;
    expect(await importsFromCommerce()).toBe(0);

    // Commerce stays the master a demo is prepared in: a name typed in Admin inside the
    // window is not one of the integration's writes, so it is imported.
    box.commerce.db.products.get("A1").name = "Trouser (Admin)";
    expect(
      (await productSaved.main(box.commerce.events.productSaved("A1")))
        .statusCode,
    ).toBe(200);
    expect(await erpName()).toBe("Trouser (Admin)");
    expect(await importsFromCommerce()).toBe(1);
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

  // AB-26y step 5: the ERP is untouched; the integration's history says what happened.
  test("Sellable item, Commerce → ERP: a product deleted in Commerce stays in the ERP and shows in the integration's history", async () => {
    await seeded();
    box.commerce.db.products.delete("B2");
    const res = await productDeleted.main({
      data: { value: { id: 102, sku: "B2" } },
    });
    expect(res.statusCode).toBe(200);
    const kept = await box.erp.call("products", { path: "/B2" });
    expect(kept.status).toBe(200);
    expect(kept.data.sku).toBe("B2");
    const deletes = (await readHistory()).filter(
      (entry) => entry.kind === "product-deleted",
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatchObject({
      direction: "commerce",
      message:
        "Product B2 was deleted in Commerce. The ERP keeps it until its next reset",
      outcome: "done",
      ref: "B2",
    });
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

  // AB-26z: the buyer's contract price is Commerce's own, a tier price in the company's
  // shared catalog, so the cart prices from the catalog and no ERP is asked on a cart
  // change. Whatever the publish wrote, detach takes back: the catalog ends as it began.
  test("Price, ERP → Commerce: contract prices in force land in the company's shared catalog, a replay writes nothing, and detach leaves the catalog as it was", async () => {
    await fillErp(readers, erp, "Box");
    const catalogBefore = structuredClone([...box.commerce.db.tierPrices]);
    const inForce = [
      {
        lines: [
          {
            contractNumber: "K1",
            kind: "price",
            minQty: 1,
            price: 8,
            sku: "A1",
          },
          {
            contractNumber: "K1",
            kind: "price",
            minQty: 1,
            price: 4,
            sku: "B2",
          },
          {
            contractNumber: "K1",
            kind: "discount",
            minQty: 10,
            percent: 15,
            sku: "A1",
          },
        ],
        partnerId: "C7",
      },
    ];
    const publish = () =>
      publishErpPrices(
        {},
        { id: "erp" },
        inForce,
        contractPriceDeps({}, [{ id: "erp" }], "erp"),
      );
    expect(await publish()).toMatchObject({
      failed: [],
      skipped: [],
      written: 3,
    });
    const catalog = Object.fromEntries(
      [...box.commerce.db.tierPrices.values()].map((r) => [
        `${r.sku} ${r.quantity}`,
        [r.customer_group, r.price_type, r.price],
      ]),
    );
    expect(catalog).toEqual({
      "A1 1": ["Northwind Trading", "fixed", 8],
      "A1 10": ["Northwind Trading", "discount", 15],
      "B2 1": ["Northwind Trading", "fixed", 4],
    });
    expect(await publish()).toMatchObject({ unchanged: 3, written: 0 });
    const result = await detach(
      {},
      { commerce: commerceLib, erp, ledger, tierPrices },
    );
    expect(result.reverted).toEqual({ failed: [], reverted: 3 });
    expect([...box.commerce.db.tierPrices]).toEqual(catalogBefore);
    expect(await ledger.readLedger()).toEqual([]);
  });

  // AB-26z with the real ERP: a price list activated in the ERP raises contract.changed, and
  // the handler puts the price into the company's shared catalog. A list ending raises an
  // event too, but a date passing raises none, so erp/prices is what follows the ERP's prices
  // in force: after the list is deactivated, a publish takes the price back out.
  test("Price, ERP → Commerce: a price list activated in the ERP reaches the company's shared catalog; after it is deactivated a publish removes it", async () => {
    await fillErp(readers, erp, "Box");
    const catalogBefore = structuredClone([...box.commerce.db.tierPrices]);
    const created = await box.erp.call("contracts", {
      body: {
        appliesTo: "customer",
        description: "Northwind 2026",
        lines: [{ kind: "price", minQty: 1, price: 8, sku: "A1" }],
        partnerId: "C7",
        startingDate: "2020-01-01",
      },
      method: "POST",
    });
    expect(created.ok).toBe(true);
    const { number } = created.data;
    await box.erp.call("contracts", {
      method: "POST",
      path: `/${number}/activate`,
    });
    expect(await deliverErpEvents()).toEqual([
      { event: "be-observer.company_contract_update", statusCode: 200 },
    ]);
    expect(box.commerce.db.tierPrices.get("A1|Northwind Trading|1|0")).toEqual({
      customer_group: "Northwind Trading",
      price: 8,
      price_type: "fixed",
      quantity: 1,
      sku: "A1",
      website_id: 0,
    });
    await box.erp.call("contracts", {
      method: "POST",
      path: `/${number}/deactivate`,
    });
    const published = await erpPrices.main({ __ow_method: "post" });
    expect(published.statusCode).toBe(200);
    expect(published.body).toMatchObject({ failed: [], removed: 1 });
    expect([...box.commerce.db.tierPrices]).toEqual(catalogBefore);
    // The deactivation's own event, delivered late, finds nothing left to do.
    expect(await deliverErpEvents()).toEqual([
      { event: "be-observer.company_contract_update", statusCode: 200 },
    ]);
    expect([...box.commerce.db.tierPrices]).toEqual(catalogBefore);
    expect(await ledger.readLedger()).toEqual([]);
  });

  // AB-16k with the real ERP: the ERP sends the price it would charge, so a customer discount
  // set on the ERP's Pricing screen, with no price list, reaches the company's shared catalog
  // as a discount on every product; the ERP's maximum discount cuts it; deleting it takes it
  // back out. Nothing in this app changed for it: it writes the set it is sent.
  test("Price, ERP → Commerce: a pricing-screen discount reaches the company's shared catalog on every product, capped by the maximum discount, and leaves when deleted", async () => {
    await fillErp(readers, erp, "Box");
    const catalogBefore = structuredClone([...box.commerce.db.tierPrices]);
    const rule = async (body) =>
      (await box.erp.call("pricing", { body, method: "POST" })).data;
    const northwind = () =>
      Object.fromEntries(
        [...box.commerce.db.tierPrices.values()]
          .filter((r) => r.customer_group === "Northwind Trading")
          .map((r) => [`${r.sku} ${r.quantity}`, [r.price_type, r.price]]),
      );
    const discount = await rule({
      kind: "contractDiscount",
      partnerId: "C7",
      percent: 10,
    });
    expect(await deliverErpEvents()).toEqual([
      { event: "be-observer.company_contract_update", statusCode: 200 },
    ]);
    expect(northwind()).toEqual({
      "A1 1": ["discount", 10],
      "B2 1": ["discount", 10],
    });
    await rule({ kind: "maxDiscount", percent: 5 });
    await deliverErpEvents();
    expect(northwind()).toEqual({
      "A1 1": ["discount", 5],
      "B2 1": ["discount", 5],
    });
    await box.erp.call("pricing", {
      method: "DELETE",
      path: `/${discount._id}`,
    });
    await deliverErpEvents();
    expect([...box.commerce.db.tierPrices]).toEqual(catalogBefore);
    expect(await ledger.readLedger()).toEqual([]);
  });
});
