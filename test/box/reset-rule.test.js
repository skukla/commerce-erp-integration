/*
 * Pair-in-a-box: the ONE reset rule (owner, 2026-10-30, changed 2026-11-11), end to end, with the
 * REAL mock ERP in this process and the fake Commerce in front. The seven example orders (the
 * owner's names, shared with Demo Builder's Clear: test/lib/reset-rule-orders.js) are each sent to
 * the ERP, then given the case's quantities and state in Commerce. erp/detach with closeOrders, as
 * Demo Builder's reset runs it, then: cancels (1), refunds offline so Commerce closes (2, 3, 4),
 * closes (4)'s open return, leaves (5) alone, and invoices what the last two have not invoiced
 * before refunding everything, so Commerce closes them too. Each order's reset note is the first
 * write to it.
 *
 * Every event Commerce raised for those writes is then delivered to the handlers, as I/O Events
 * would: the order saves to order-commerce/created and changed, the invoice saves to
 * order-commerce/invoiced, the return save to order-commerce/return-saved. None may reach the
 * ERP. A second run changes nothing.
 *
 * Last, an order closed the way Demo Builder's Clear closes it (in Commerce, its note first, no
 * mark in this app's State): its events reach no ERP either, recognised by the note alone.
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
vi.mock("#src/order/commerce-order-api-client", () => box.commerce.orderClient);
vi.mock(
  "#src/order/commerce-shipment-api-client",
  () => box.commerce.shipmentClient,
);

import { erp } from "#lib/erp";
import * as keyMap from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { closedByReset } from "#lib/order-parts";
import { refundedNote, refundOf } from "#lib/reset-rule";
import * as detachAction from "#src/erp/detach/index";
import * as orderChanged from "#src/order/commerce/changed/index";
import * as orderCreated from "#src/order/commerce/created/index";
import * as invoiced from "#src/order/commerce/invoiced/index";
import * as returnSaved from "#src/order/commerce/return-saved/index";

import { RESET_RULE_CASES } from "../lib/reset-rule-orders.js";
import { fillErp } from "./fill-erp.js";

const DAY = "2026-10-30";
const NOTES = {
  canceled: `Canceled by the demo reset on ${DAY}.`,
  refunded: `Refunded and closed by the demo reset on ${DAY}.`,
};
/** The state each outcome leaves the order in: every one ends Canceled or Closed. */
const STATE = { canceled: "canceled", refunded: "closed", untouched: "closed" };
/** The writes that settle an order, which its note must come before. */
const SETTLING = ["cancel", "invoiceRemainder", "refundOrder"];

const statusOf = (res) => res.statusCode ?? res.error?.statusCode;
const orderOf = (id) => box.commerce.db.orders.get(id);
/** The writes the reset made on an order (after the orders were placed). */
const writesOn = (id) =>
  box.commerce.writes
    .slice(run.writesBefore)
    .filter((w) => w.orderId === String(id));
const resetNotesOn = (id) =>
  writesOn(id)
    .filter((w) => w.kind === "comment" && w.comment.includes("demo reset"))
    .map((w) => w.comment);
const run = {};
const closeAll = () =>
  detachAction.main({ __ow_method: "post", closeOrders: true });

/** The case's order in the fake store, as it is before the shop sends it: nothing done yet. */
function addOrder({ order }) {
  const base = box.commerce.db.orders.get(55);
  box.commerce.db.orders.set(order.entity_id, {
    ...structuredClone(base),
    entity_id: order.entity_id,
    ext_order_id: null,
    increment_id: order.increment_id,
    // The ERP knows A1, so each case's line is an A1 line with the case's own item id.
    items: order.items.map((line) => ({
      base_price: 10,
      item_id: line.item_id,
      product_id: 101,
      qty_ordered: line.qty_ordered,
      sku: "A1",
    })),
  });
}

/** Then what the case says happened to it in Commerce: invoiced, shipped, refunded, its state. */
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
  return returns.map((rma) => {
    const id = box.commerce.adminCreateReturn(
      order.entity_id,
      order.items.map((line) => ({ order_item_id: line.item_id, qty: 1 })),
    );
    box.commerce.db.returns.get(id).status = rma.status;
    return id;
  });
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T15:00:00Z`));
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
  await fillErp(box.commerce.lib, erp, "Box");
  run.returns = {};
  for (const c of RESET_RULE_CASES) {
    addOrder(c);
    // biome-ignore lint/performance/noAwaitInLoops: orders are placed one at a time, in order
    const placed = await orderCreated.main(
      box.commerce.events.orderSaved(c.order.entity_id, { isNew: true }),
    );
    expect(statusOf(placed)).toBe(200);
    expect(orderOf(c.order.entity_id).ext_order_id).toBeTruthy();
    run.returns[c.order.entity_id] = applyCase(c);
  }
  run.requestsBefore = box.requests.length;
  run.savesBefore = box.commerce.orderSaves.length;
  run.returnSavesBefore = box.commerce.returnSaves.length;
  run.invoiceSavesBefore = box.commerce.invoiceSaves.length;
  run.writesBefore = box.commerce.writes.length;
  run.first = await closeAll();
});
afterAll(() => vi.useRealTimers());

describe("Pair in a box: the one reset rule on the example orders", () => {
  test("Then the reset answers what it did: one canceled, five refunded, none left open, one return closed, one already closed", () => {
    expect(statusOf(run.first)).toBe(200);
    expect(run.first.body.closed).toEqual({
      alreadyClosed: 1,
      cancelled: 1,
      commented: 0,
      failed: [],
      partsRemoved: RESET_RULE_CASES.length,
      refunded: 5,
      returnsClosed: 1,
    });
  });

  test.each(RESET_RULE_CASES.map((c) => [c.name, c]))("%s", (_name, c) => {
    const { order, expected, closesReturn, invoices } = c;
    const id = order.entity_id;
    expect(orderOf(id).state).toBe(STATE[expected]);
    expect(orderOf(id).ext_order_id).toBe("");
    const refunds = writesOn(id).filter((w) => w.kind === "refundOrder");
    if (expected === "untouched") {
      // Only the ERP number the ERP gave it is cleared; nothing is canceled, refunded or noted.
      expect(writesOn(id).map((w) => w.kind)).toEqual(["clearExtOrderId"]);
      return;
    }
    expect(resetNotesOn(id)).toEqual([NOTES[expected]]);
    // The note is the reset's first write to the order (detach's ERP number clear aside).
    const kinds = writesOn(id)
      .map((w) => w.kind)
      .filter((k) => k !== "clearExtOrderId");
    expect(kinds[0]).toBe("comment");
    expect(kinds.filter((k) => SETTLING.includes(k))).toEqual(
      expected === "canceled"
        ? ["cancel"]
        : [...(invoices ? ["invoiceRemainder"] : []), "refundOrder"],
    );
    if (expected === "canceled") {
      expect(refunds).toEqual([]);
      return;
    }
    expect(refunds).toHaveLength(1);
    // Everything invoiced, after the invoice of what was left: every line in full.
    expect(refunds[0].body).toEqual({
      arguments: {
        adjustment_negative: 0,
        adjustment_positive: 0,
        shipping_amount: order.base_shipping_invoiced ?? 0,
      },
      items: order.items.map((line) => ({
        order_item_id: line.item_id,
        qty: invoices ? line.qty_ordered : line.qty_invoiced,
      })),
      notify: false,
    });
    for (const returnId of run.returns[id]) {
      expect(closesReturn).toBeDefined();
      expect(box.commerce.db.returns.get(returnId).status).toBe("closed");
    }
  });

  test("Then every event the reset's writes raised, delivered to its handler, reaches no ERP", async () => {
    const orderSaves = box.commerce.orderSaves.slice(run.savesBefore);
    const returnSaves = box.commerce.returnSaves.slice(run.returnSavesBefore);
    const invoiceSaves = box.commerce.invoiceSaves.slice(
      run.invoiceSavesBefore,
    );
    // The cancel and five refunds at least (a note raises no save here); the one return close;
    // the two invoices of what was left.
    const namingSaves = 6;
    expect(orderSaves.length).toBeGreaterThanOrEqual(namingSaves);
    expect(returnSaves).toHaveLength(1);
    expect(invoiceSaves).toHaveLength(2);
    const answers = [];
    for (const event of orderSaves) {
      const number = event.data.value.increment_id;
      // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
      answers.push([number, await orderCreated.main(structuredClone(event))]);
      answers.push([number, await orderChanged.main(structuredClone(event))]);
    }
    for (const event of returnSaves) {
      const order = orderOf(event.data.value.order_id).increment_id;
      // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
      answers.push([order, await returnSaved.main(structuredClone(event))]);
    }
    for (const event of invoiceSaves) {
      const order = orderOf(event.data.value.order_id).increment_id;
      // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
      answers.push([order, await invoiced.main(structuredClone(event))]);
    }
    // Every save that names its order is answered by the reset's mark. The ERP number clear is
    // a sparse save carrying only that field (measured 2026-09-25), which names no order: the
    // new-order path refuses it (400) and the change path finds no ERP number, as before.
    for (const [number, res] of answers) {
      expect(statusOf(res)).toBeLessThan(500);
      if (number) {
        expect(res.body.message).toBe(
          `order ${number} was closed by the demo reset on ${DAY}; it is not sent to any ERP.`,
        );
      }
    }
    expect(answers.filter(([number]) => number)).toHaveLength(
      2 * orderSaves.filter((e) => e.data.value.increment_id).length +
        returnSaves.length +
        invoiceSaves.length,
    );
    // The reset and its events only read the ERP's order list and orders: nothing was created,
    // canceled, refunded, held or returned there.
    const since = box.requests.slice(run.requestsBefore);
    expect(since.filter((r) => r.method !== "GET")).toEqual([]);
  });

  test("Then a second run, before the ERP is wiped, cancels, refunds, closes and notes nothing", async () => {
    const writes = box.commerce.writes.length;
    const returnSaves = box.commerce.returnSaves.length;
    const again = await closeAll();
    expect(again.body.closed).toEqual({
      alreadyClosed: RESET_RULE_CASES.length,
      cancelled: 0,
      commented: 0,
      failed: [],
      partsRemoved: 0,
      refunded: 0,
      returnsClosed: 0,
    });
    // Only detach's own clearing of the ERP numbers the ERP still lists, which writes the same
    // empty value again.
    expect(
      box.commerce.writes
        .slice(writes)
        .filter((w) => w.kind !== "clearExtOrderId"),
    ).toEqual([]);
    expect(box.commerce.returnSaves.length).toBe(returnSaves);
  });
});

describe("Pair in a box: an order closed the way Demo Builder's Clear closes it", () => {
  test("Then its events reach no ERP: no mark in State, its reset note in Commerce's history is enough", async () => {
    const [, , , , , shipped] = RESET_RULE_CASES;
    const cleared = {
      ...shipped,
      order: { ...shipped.order, entity_id: 708, increment_id: "000000708" },
    };
    addOrder(cleared);
    const placed = await orderCreated.main(
      box.commerce.events.orderSaved(708, { isNew: true }),
    );
    expect(statusOf(placed)).toBe(200);
    applyCase(cleared);
    const requests = box.requests.length;
    const saves = box.commerce.orderSaves.length;
    const invoiceSaves = box.commerce.invoiceSaves.length;

    // Clear's writes, in its order: the note first, then the invoice of what is left, then the
    // refund of everything invoiced. It writes nothing to this app's State.
    await box.commerce.lib.orders.comment({}, 708, refundedNote(DAY));
    await box.commerce.orderClient.invoiceRemainder({}, 708);
    const now = await box.commerce.lib.orders.get({}, 708);
    await box.commerce.orderClient.refundOrder({}, 708, refundOf(now));
    expect(orderOf(708).state).toBe("closed");
    expect(await closedByReset("000000708")).toBeNull();

    const answers = [];
    for (const event of box.commerce.orderSaves.slice(saves)) {
      // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
      answers.push(await orderCreated.main(structuredClone(event)));
      answers.push(await orderChanged.main(structuredClone(event)));
    }
    for (const event of box.commerce.invoiceSaves.slice(invoiceSaves)) {
      // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
      answers.push(await invoiced.main(structuredClone(event)));
    }
    // The refund's order save and the invoice's save.
    expect(answers).toHaveLength(3);
    for (const res of answers) {
      expect(statusOf(res)).toBe(200);
      expect(res.body.message).toBe(
        `order 000000708 was closed by the demo reset on ${DAY}; it is not sent to any ERP.`,
      );
    }
    expect(box.requests.slice(requests)).toEqual([]);
  });
});
