/*
 * Pair-in-a-box: a store-scoped close (erp/close-orders, owner 2026-10-30). Demo Builder's store
 * wipe closes an ERP-served store's orders in one call to this integration, so the ERP never hears
 * of them, then refreshes the ERP from Commerce. The seven shared example orders
 * (test/lib/reset-rule-orders.js) are placed in the main website's store and sent to the REAL mock
 * ERP; a decoy order is placed in the eu website's store. Closing the main store must close the
 * seven by the one reset rule (the same lib/close-orders.js the whole reset runs), forget them,
 * leave the decoy and the ledger alone, wipe nothing in the ERP, and send it nothing, the close's
 * events included.
 */
const box = await vi.hoisted(async () => {
  const { createFakeCommerce } = await import("./fake-commerce.js");
  const { startErp } = await import("./erp-in-process.js");
  const { fakeState } = await import("./state.js");
  const { erpClientModule, settingsModule } = await import("./box-modules.js");
  const erpBox = startErp();
  // Every request the ERP was sent: the action, the method and the path.
  const requests = [];
  const call = (action, request = {}) => {
    requests.push({
      action,
      method: request.method ?? "GET",
      path: request.path ?? "",
    });
    return erpBox.call(action, request);
  };
  return {
    commerce: createFakeCommerce(),
    erp: erpBox,
    erpClient: erpClientModule(call),
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
import * as returnSaved from "#src/order/commerce/return-saved/index";

import { RESET_RULE_CASES } from "../lib/reset-rule-orders.js";
import { fillErp } from "./fill-erp.js";

const DAY = "2026-10-30";
const DECOY = 55;
const RUN = "store-close-0001";
/** What the close answers per order, in the words of `touched`. */
const TOUCHED = {
  canceled: "cancelled",
  noted: "commented",
  refunded: "refunded",
  untouched: "alreadyClosed",
};

const statusOf = (res) => res.statusCode ?? res.error?.statusCode;
const messageOf = (res) => res.body?.message ?? res.error?.body?.message;
const orderOf = (id) => box.commerce.db.orders.get(id);
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
  // A write the ERP made on Commerce, ledgered: only the whole reset puts it back.
  await ledger.recordProductWrite({
    after: 12,
    before: 10,
    erpId: "erp",
    field: "price",
    sku: "A1",
  });
  run.ledgerBefore = await ledger.readLedger();
  run.erpOrdersBefore = (await box.erp.call("orders")).data.items.length;
  run.requestsBefore = box.requests.length;
  run.savesBefore = box.commerce.orderSaves.length;
  run.returnSavesBefore = box.commerce.returnSaves.length;
  run.writesBefore = box.commerce.writes.length;
  run.first = await closeStore({ run: RUN });
});
afterAll(() => vi.useRealTimers());

describe("Pair in a box: a store-scoped close of the main store", () => {
  test("Then the answer names the scope, counts what the one reset rule did, and lists each order it touched", () => {
    expect(statusOf(run.first)).toBe(200);
    expect(run.first.body).toEqual({
      closed: {
        alreadyClosed: 1,
        cancelled: 1,
        commented: 1,
        failed: [],
        partsRemoved: RESET_RULE_CASES.length,
        refunded: 4,
        returnsClosed: 1,
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
        outcome: c.staysOpen ? "refundedOpen" : TOUCHED[c.expected],
      })),
    });
  });

  test("Then each example order ends as the one reset rule says and is forgotten", async () => {
    for (const { order, expected, staysOpen } of RESET_RULE_CASES) {
      const stored = orderOf(order.entity_id);
      expect(stored.ext_order_id).toBe("");
      if (expected === "canceled") {
        expect(stored.state).toBe("canceled");
      } else if (expected === "refunded" && !staysOpen) {
        expect(stored.state).toBe("closed");
      }
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

  test("Then the ledger is not undone and the ERP is not wiped: that stays the whole reset's job", async () => {
    expect(await ledger.readLedger()).toEqual(run.ledgerBefore);
    const kinds = box.commerce.writes
      .slice(run.writesBefore)
      .map((w) => w.kind);
    expect(kinds).not.toContain("setProductPrice");
    expect((await box.erp.call("orders")).data.items).toHaveLength(
      run.erpOrdersBefore,
    );
  });

  test("Then the close, and every event its writes raised, sent the ERP nothing", async () => {
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
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((res) => statusOf(res) < 500)).toBe(true);
    expect(box.requests.slice(run.requestsBefore)).toEqual([]);
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

  test("Then a GET without a run is refused, and GET never closes", async () => {
    const res = await closeAction.main({ __ow_method: "get" });
    expect(statusOf(res)).toBe(400);
  });
});
