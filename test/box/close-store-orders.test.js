/*
 * Pair-in-a-box: a store-scoped close (erp/close-orders, owner 2026-10-30). Demo Builder's store
 * wipe closes an ERP-served store's orders in one call to this integration, so the ERP never hears
 * of them, then refreshes the ERP from Commerce. The seven shared example orders
 * (test/lib/reset-rule-orders.js) are placed in the main website's store and sent to the REAL mock
 * ERP; a decoy order is placed in the eu website's store. Closing the main store must close the
 * seven by the one reset rule (the same lib/close-orders.js the whole reset runs; every one ends
 * Canceled or Closed, the last two invoiced for what was left before the refund), forget them,
 * and leave the decoy and the ledger alone. The ERP is transient (owner, 2026-10-30): it is then
 * asked once to remove its own sales orders for the seven, with their invoices and shipments
 * (admin/remove-orders, contract version 23), and keeps the decoy's. The close's events send it
 * nothing. An ERP from before version 23 is named as unsupported and the close still finishes.
 */
const box = await vi.hoisted(async () => {
  const { createFakeCommerce } = await import("./fake-commerce.js");
  const { startErp } = await import("./erp-in-process.js");
  const { fakeState } = await import("./state.js");
  const { erpClientModule, settingsModule } = await import("./box-modules.js");
  const erpBox = startErp();
  // Every request the ERP was sent: the action, the method and the path.
  const requests = [];
  // "old": the ERP answers as one from before contract version 23, which has no remove-orders.
  const erpMode = { contract: "current" };
  const call = (action, request = {}) => {
    requests.push({
      action,
      method: request.method ?? "GET",
      path: request.path ?? "",
    });
    if (erpMode.contract === "old" && request.path === "/remove-orders") {
      return Promise.resolve({
        data: { error: { code: "NO_ROUTE" } },
        ok: false,
        status: 404,
      });
    }
    return erpBox.call(action, request);
  };
  return {
    commerce: createFakeCommerce(),
    erp: erpBox,
    erpClient: erpClientModule(call),
    erpMode,
    requests,
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
vi.mock("#lib/commerce-store-scope", () => box.commerce.storeScope);
vi.mock("#src/order/commerce-order-api-client", () => box.commerce.orderClient);
vi.mock(
  "#src/order/commerce-shipment-api-client",
  () => box.commerce.shipmentClient,
);

import { resetRunsClient } from "#lib/action-runs";
import { erp } from "#lib/erp";
import * as keyMap from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { listOrderPartsIds } from "#lib/order-parts";
import * as closeAction from "#src/erp/close-orders/index";
import * as statusAction from "#src/erp/status/index";
import * as orderChanged from "#src/order/commerce/changed/index";
import * as orderCreated from "#src/order/commerce/created/index";
import * as invoiced from "#src/order/commerce/invoiced/index";
import * as returnSaved from "#src/order/commerce/return-saved/index";

import { RESET_RULE_CASES } from "../lib/reset-rule-orders.js";
import { fillErp } from "./fill-erp.js";

const DAY = "2026-10-30";
const DECOY = 55;
const RUN = "store-close-0001";
/** What the close answers per order, in the words of `touched`. */
const TOUCHED = {
  canceled: "cancelled",
  refunded: "refunded",
  untouched: "alreadyClosed",
};

const statusOf = (res) => res.statusCode ?? res.error?.statusCode;
const messageOf = (res) => res.body?.message ?? res.error?.body?.message;
const orderOf = (id) => box.commerce.db.orders.get(id);
/** The ERP's own sales orders, by the web shop's order number. */
const erpOrders = async () =>
  (await box.erp.call("orders")).data.items.map(
    (o) => o.purchaseOrderByCustomer,
  );
const erpCall = (action, method, path) =>
  box.erp.call(action, { method, path });
/** Ship and invoice the web shop order's sales order in the ERP: a shipment and an invoice on it. */
async function shipAndInvoiceInErp(incrementId) {
  const order = (await box.erp.call("orders")).data.items.find(
    (o) => o.purchaseOrderByCustomer === incrementId,
  );
  await erpCall("orders", "POST", `/${order.number}/confirm`);
  await box.erp.call("orders", {
    body: { status: "shipped" },
    method: "POST",
    path: `/${order.number}/status`,
  });
  await erpCall("orders", "POST", `/${order.number}/invoice`);
}
const closeStore = (extra = {}) =>
  closeAction.main({
    __ow_method: "post",
    stores: ["main_website_store"],
    ...extra,
  });

/** The case's order in the main store, as it is before the shop sends it: nothing done yet. */
function addOrder({ order }) {
  const base = orderOf(DECOY);
  box.commerce.db.orders.set(order.entity_id, {
    ...structuredClone(base),
    entity_id: order.entity_id,
    ext_order_id: null,
    increment_id: order.increment_id,
    items: order.items.map((line) => ({
      base_price: 10,
      item_id: line.item_id,
      product_id: 101,
      qty_ordered: line.qty_ordered,
      sku: "A1",
    })),
    store_id: 1,
  });
}

/** Then what the case says happened to it in Commerce. */
function applyCase({ order, returns }) {
  const stored = orderOf(order.entity_id);
  for (const line of order.items) {
    Object.assign(
      stored.items.find((i) => i.item_id === line.item_id),
      {
        qty_canceled: line.qty_canceled,
        qty_invoiced: line.qty_invoiced,
        qty_refunded: line.qty_refunded,
        qty_shipped: line.qty_shipped,
      },
    );
  }
  Object.assign(stored, {
    base_shipping_invoiced: order.base_shipping_invoiced,
    base_shipping_refunded: order.base_shipping_refunded,
    state: order.state,
    status: order.status,
  });
  for (const rma of returns) {
    const id = box.commerce.adminCreateReturn(
      order.entity_id,
      order.items.map((line) => ({ order_item_id: line.item_id, qty: 1 })),
    );
    box.commerce.db.returns.get(id).status = rma.status;
  }
}

const run = {};

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T15:00:00Z`));
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
  resetRunsClient(box.state);
  await fillErp(box.commerce.lib, erp, "Box");
  for (const c of RESET_RULE_CASES) {
    addOrder(c);
    // biome-ignore lint/performance/noAwaitInLoops: orders are placed one at a time, in order
    const placed = await orderCreated.main(
      box.commerce.events.orderSaved(c.order.entity_id, { isNew: true }),
    );
    expect(statusOf(placed)).toBe(200);
    applyCase(c);
  }
  // The decoy: an open order in the eu website's store, sent to the ERP like the others.
  orderOf(DECOY).store_id = 2;
  expect(
    statusOf(
      await orderCreated.main(
        box.commerce.events.orderSaved(DECOY, { isNew: true }),
      ),
    ),
  ).toBe(200);
  run.decoyBefore = structuredClone(orderOf(DECOY));
  // In the ERP: one of the main store's orders and the decoy shipped and invoiced there.
  await shipAndInvoiceInErp("000000703");
  await shipAndInvoiceInErp("000000042");
  run.erpBefore = await erpOrders();
  run.erpInvoicesBefore = (await box.erp.call("invoices")).data.items.length;
  // A write the ERP made on Commerce, ledgered: only the whole reset puts it back.
  await ledger.recordProductWrite({
    after: 12,
    before: 10,
    erpId: "erp",
    field: "price",
    sku: "A1",
  });
  run.ledgerBefore = await ledger.readLedger();
  run.requestsBefore = box.requests.length;
  run.savesBefore = box.commerce.orderSaves.length;
  run.returnSavesBefore = box.commerce.returnSaves.length;
  run.invoiceSavesBefore = box.commerce.invoiceSaves.length;
  run.writesBefore = box.commerce.writes.length;
  run.first = await closeStore({ run: RUN });
  run.closeRequests = box.requests.slice(run.requestsBefore);
});
afterAll(() => vi.useRealTimers());

describe("Pair in a box: a store-scoped close of the main store", () => {
  test("Then the answer names the scope, counts what the one reset rule did, and lists each order it touched", () => {
    expect(statusOf(run.first)).toBe(200);
    expect(run.first.body).toEqual({
      closed: {
        alreadyClosed: 1,
        cancelled: 1,
        commented: 0,
        failed: [],
        partsRemoved: RESET_RULE_CASES.length,
        refunded: 5,
        returnsClosed: 1,
      },
      erpRemoved: {
        erp: {
          notFound: [],
          removed: {
            creditMemos: 0,
            events: expect.any(Number),
            invoices: 1,
            payments: 0,
            returnOrders: 0,
            salesOrders: RESET_RULE_CASES.length,
            shipments: 1,
          },
        },
      },
      holds: { failed: [], released: 0 },
      orders: { cleared: RESET_RULE_CASES.length, failed: [] },
      scope: {
        stores: ["main_website_store"],
        storeViewIds: [1],
        websites: [],
      },
      touched: RESET_RULE_CASES.map((c) => ({
        orderId: c.order.increment_id,
        outcome: TOUCHED[c.expected],
      })),
    });
  });

  test("Then each example order ends as the one reset rule says and is forgotten", async () => {
    for (const { order, expected } of RESET_RULE_CASES) {
      const stored = orderOf(order.entity_id);
      expect(stored.ext_order_id).toBe("");
      expect(stored.state).toBe(
        expected === "canceled" ? "canceled" : "closed",
      );
    }
    expect(await listOrderPartsIds()).toEqual(["000000042"]);
  });

  test("Then the decoy in the other store is untouched: same order, its ERP number, its parts record, no write", () => {
    expect(orderOf(DECOY)).toEqual(run.decoyBefore);
    expect(orderOf(DECOY).ext_order_id).toBeTruthy();
    expect(
      box.commerce.writes
        .slice(run.writesBefore)
        .filter((w) => w.orderId === String(DECOY)),
    ).toEqual([]);
  });

  test("Then the ERP keeps none of the main store's sales orders, invoices or shipments, and keeps the decoy's", async () => {
    // Control: before the close the ERP held all eight.
    expect(run.erpBefore.sort()).toEqual(
      [
        "000000042",
        ...RESET_RULE_CASES.map((c) => c.order.increment_id),
      ].sort(),
    );
    expect(run.erpInvoicesBefore).toBe(2);
    expect(await erpOrders()).toEqual(["000000042"]);
    const invoices = (await box.erp.call("invoices")).data.items;
    expect(invoices).toHaveLength(1);
    const [decoy] = (await box.erp.call("orders")).data.items;
    expect(decoy.shipments).toHaveLength(1);
  });

  test("Then the ledger is not undone and the ERP is not wiped: that stays the whole reset's job", async () => {
    expect(await ledger.readLedger()).toEqual(run.ledgerBefore);
    const kinds = box.commerce.writes
      .slice(run.writesBefore)
      .map((w) => w.kind);
    expect(kinds).not.toContain("setProductPrice");
    // The fill the reset brings back is not needed for the decoy: its customer and products stay.
    expect((await box.erp.call("products")).data.items.length).toBeGreaterThan(
      0,
    );
  });

  test("Then the close asked the ERP one thing, to remove the main store's orders, and its events sent it nothing", async () => {
    expect(run.closeRequests).toEqual([
      { action: "admin", method: "POST", path: "/remove-orders" },
    ]);
    const before = box.requests.length;
    const answers = [];
    for (const event of box.commerce.orderSaves.slice(run.savesBefore)) {
      // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
      answers.push(await orderCreated.main(structuredClone(event)));
      answers.push(await orderChanged.main(structuredClone(event)));
    }
    for (const event of box.commerce.returnSaves.slice(run.returnSavesBefore)) {
      // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
      answers.push(await returnSaved.main(structuredClone(event)));
    }
    const invoiceSaves = box.commerce.invoiceSaves.slice(
      run.invoiceSavesBefore,
    );
    // The two invoices of what was left, before their refunds.
    expect(invoiceSaves).toHaveLength(2);
    for (const event of invoiceSaves) {
      // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
      answers.push(await invoiced.main(structuredClone(event)));
    }
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((res) => statusOf(res) < 500)).toBe(true);
    expect(box.requests.slice(before)).toEqual([]);
  });

  test("Then the run can be asked about, and answers what the POST answered", async () => {
    const polled = await closeAction.main({ __ow_method: "get", run: RUN });
    expect(polled.statusCode).toBe(200);
    expect(polled.body).toMatchObject({
      result: run.first.body,
      run: RUN,
      status: "done",
    });
  });

  test("Then a second close of the same store changes nothing", async () => {
    const writes = box.commerce.writes.length;
    const again = await closeStore();
    expect(again.body.closed).toMatchObject({
      alreadyClosed: RESET_RULE_CASES.length,
      cancelled: 0,
      refunded: 0,
      returnsClosed: 0,
    });
    expect(box.commerce.writes.slice(writes)).toEqual([]);
  });

  test("Then erp/status says this deployment closes orders by store", async () => {
    const res = await statusAction.main({});
    expect(res.body.closesOrdersByStore).toBe(true);
  });
});

describe("Given a store-scoped close that cannot run", () => {
  test.each([
    [
      "one ERP named",
      { erp: "erp" },
      "close-orders closes the orders of every ERP the integration serves, so it cannot be asked for one ERP (erp=erp)",
    ],
    [
      "no store or website named",
      { stores: [] },
      "name the stores (stores) or websites (websites) whose orders to close, by code",
    ],
    [
      "a code the store does not have",
      { stores: ["main_website_store", "nope"], websites: ["mars"] },
      "the store has no store nope, website mars; nothing was closed",
    ],
  ])(
    "Then %s is refused with a 400 before anything is read or written",
    async (_why, extra, message) => {
      const writes = box.commerce.writes.length;
      const res = await closeStore(extra);
      expect(statusOf(res)).toBe(400);
      expect(messageOf(res)).toBe(message);
      expect(box.commerce.writes.length).toBe(writes);
    },
  );

  test("Then a website with no orders closes nothing and says so", async () => {
    box.commerce.db.orders.get(DECOY).store_id = 2;
    const res = await closeAction.main({
      __ow_method: "post",
      websites: "bare",
    });
    expect(statusOf(res)).toBe(200);
    expect(res.body.touched).toEqual([]);
    expect(res.body.scope.storeViewIds).toEqual([]);
  });

  test("Then an ERP from before contract version 23 is named unsupported, and the Commerce close still finishes", async () => {
    const id = 708;
    addOrder({
      order: {
        entity_id: id,
        increment_id: "000000708",
        items: [{ item_id: 81, qty_ordered: 1 }],
      },
    });
    await orderCreated.main(
      box.commerce.events.orderSaved(id, { isNew: true }),
    );
    box.erpMode.contract = "old";
    try {
      const res = await closeStore();
      expect(statusOf(res)).toBe(200);
      expect(res.body.erpRemoved).toEqual({ erp: "unsupported" });
      expect(res.body.touched).toContainEqual({
        orderId: "000000708",
        outcome: "cancelled",
      });
      expect(orderOf(id).state).toBe("canceled");
      expect(await erpOrders()).toContain("000000708");
    } finally {
      box.erpMode.contract = "current";
    }
  });

  test("Then a GET without a run is refused, and GET never closes", async () => {
    const res = await closeAction.main({ __ow_method: "get" });
    expect(statusOf(res)).toBe(400);
  });
});
