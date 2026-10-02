/*
 * Pair-in-a-box with two ERPs: only ONE ERP fulfils its part of a split order (the path the
 * Justrite order took on 2026-10-02, never walked here before). Order 55 is split: A1 (line 1)
 * is ERP A's, B2 (line 2) is ERP B's. ERP A alone confirms, ships and invoices; Commerce must
 * get a shipment and an invoice of ONLY A's line, the order must not be Complete, and ERP B
 * must hear nothing. Then ERP B does the same and the order completes.
 *
 * Every shipment and invoice the integration makes in Commerce raises Commerce's own event
 * back (Shipment Saved, Invoice Saved), and the box delivers those too, carrying only the
 * fields their subscriptions name (app.commerce.config.ts): the invoice event names no lines.
 */
const box = await vi.hoisted(async () => {
  const { createFakeCommerce } = await import("./fake-commerce.js");
  const { startErp } = await import("./erp-in-process.js");
  const { fakeState } = await import("./state.js");
  const { erpClientModule, settingsModule } = await import("./box-modules.js");
  const ERP_B_URL = "https://erp-b.example/api/v1/web/erp";
  const erpA = startErp();
  const erpB = startErp();
  // Every request the integration sent either ERP, with how the ERP answered.
  const requests = [];
  const call = async (action, request = {}) => {
    const toB = request.params?.ERP_BASE_URL === ERP_B_URL;
    const res = await (toB ? erpB : erpA).call(action, request);
    requests.push({
      action,
      body: request.body,
      method: request.method ?? "GET",
      ok: res.ok,
      path: request.path ?? "",
      to: toB ? "b" : "a",
      why: res.data?.errorMessage,
    });
    return res;
  };
  return {
    commerce: createFakeCommerce(),
    ERP_B_URL,
    erpA,
    erpB,
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
vi.mock("#src/stock/commerce-stock-api-client", () => box.commerce.stockClient);

import { erp } from "#lib/erp";
import { replaceErps, resetErpsClient } from "#lib/erps";
import * as keyMap from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { readOrderParts } from "#lib/order-parts";
import * as orderCreated from "#src/order/commerce/created/index";
import * as orderInvoiced from "#src/order/commerce/invoiced/index";
import * as orderShipped from "#src/order/commerce/shipped/index";

import { deliverErpEvents } from "./deliver-erp-events.js";
import { fillErp } from "./fill-erp.js";

const ERP_A_URL = "https://erp-a.example/api/v1/web/erp";
const ORDER = "000000042";
const ORDER_ID = 55;
const LINE_A = { order_item_id: 1, qty: 12 };
const LINE_B = { order_item_id: 2, qty: 4 };

const statusOf = (res) => res.statusCode ?? res.error?.statusCode;
const salesOrderIn = async (erpBox) =>
  (await erpBox.call("orders")).data.items.find(
    (o) => o.purchaseOrderByCustomer === ORDER,
  );
/** What the integration asked an ERP to change (everything but reads), since `from`. */
const toldSince = (to, from) =>
  box.requests
    .slice(from)
    .filter((r) => r.to === to && r.method !== "GET")
    .map((r) => ({ ok: r.ok, path: r.path, why: r.why }));

/** Confirm, ship and invoice the order in one ERP, and deliver what it raised. */
async function fulfilIn(erpBox, erpId) {
  const { number } = await salesOrderIn(erpBox);
  await erpBox.call("orders", { method: "POST", path: `/${number}/confirm` });
  await erpBox.call("orders", {
    body: { status: "shipped" },
    method: "POST",
    path: `/${number}/status`,
  });
  await erpBox.call("orders", { method: "POST", path: `/${number}/invoice` });
  return (await deliverErpEvents(erpBox, { erpId })).map((d) => [
    d.event,
    d.status,
    d.why,
  ]);
}

/**
 * Deliver Commerce's own events for every shipment and invoice it holds from `seen` on, the
 * way I/O Events hands them to the order-commerce handlers; answers each handler's answer.
 */
async function deliverCommerceEvents(seen) {
  const answers = [];
  const { invoices, shipments } = box.commerce.db;
  for (const invoice of invoices.slice(seen.invoices)) {
    // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
    const res = await orderInvoiced.main(
      box.commerce.events.invoiceSaved(invoice.entity_id),
    );
    answers.push(["invoice", statusOf(res), res.error?.body?.message]);
  }
  for (const shipment of shipments.slice(seen.shipments)) {
    // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
    const res = await orderShipped.main(
      box.commerce.events.shipmentSaved(shipment.entity_id),
    );
    answers.push(["shipment", statusOf(res), res.error?.body?.message]);
  }
  return answers;
}

const documents = () => ({
  invoices: box.commerce.db.invoices.map((i) => i.items),
  shipments: box.commerce.db.shipments.map((s) => s.items),
});

const FULFILLED = [
  ["be-observer.sales_order_status_update", 200, undefined],
  ["be-observer.sales_order_shipment_create", 200, undefined],
  ["be-observer.sales_order_invoice_create", 200, undefined],
];

async function twoErps() {
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
}

beforeEach(async () => {
  box.commerce.reset();
  box.erpA.reset();
  box.erpB.reset();
  box.state.reset();
  resetErpsClient(box.state);
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
  await twoErps();
  box.requests.length = 0;
});

/**
 * The journey, from an order event as given: only ERP A fulfils, then ERP B.
 * @param {object} placed the order save event Commerce raised
 */
async function onlyAThenB(placed) {
  expect(statusOf(await orderCreated.main(placed))).toBe(200);
  // Each ERP holds its own line, named by Commerce's item id.
  expect(
    (await salesOrderIn(box.erpA)).lines.map((l) => l.customerLineReference),
  ).toEqual(["1"]);
  expect(
    (await salesOrderIn(box.erpB)).lines.map((l) => l.customerLineReference),
  ).toEqual(["2"]);

  // ERP A alone confirms, ships and invoices.
  let from = box.requests.length;
  expect(await fulfilIn(box.erpA, "erp")).toEqual(FULFILLED);
  expect(documents()).toEqual({ invoices: [[LINE_A]], shipments: [[LINE_A]] });
  // Commerce's own events for that invoice and shipment: every one taken, none refused.
  expect(await deliverCommerceEvents({ invoices: 0, shipments: 0 })).toEqual([
    ["invoice", 200, undefined],
    ["shipment", 200, undefined],
  ]);
  // ERP B was told nothing, so it refused nothing; its sales order is as it was sent.
  expect(toldSince("b", from)).toEqual([]);
  expect(toldSince("a", from).filter((r) => !r.ok)).toEqual([]);
  const inB = await salesOrderIn(box.erpB);
  expect([inB.header, inB.invoice ?? null, inB.shipments]).toEqual([
    "created",
    null,
    [],
  ]);
  // Half the order is fulfilled: not Complete, and nothing more reached Commerce.
  expect(box.commerce.db.orders.get(ORDER_ID).state).toBe("processing");
  expect(documents()).toEqual({ invoices: [[LINE_A]], shipments: [[LINE_A]] });
  let record = await readOrderParts(ORDER);
  expect([record.parts.erp.status, record.parts["brand-b"].status]).toEqual([
    "invoiced",
    "sent",
  ]);

  // ERP B does the same: its line alone ships and is invoiced, and the order completes.
  from = box.requests.length;
  expect(await fulfilIn(box.erpB, "brand-b")).toEqual(FULFILLED);
  expect(documents()).toEqual({
    invoices: [[LINE_A], [LINE_B]],
    shipments: [[LINE_A], [LINE_B]],
  });
  expect(await deliverCommerceEvents({ invoices: 1, shipments: 1 })).toEqual([
    ["invoice", 200, undefined],
    ["shipment", 200, undefined],
  ]);
  // This time ERP A is the one that hears nothing.
  expect(toldSince("a", from)).toEqual([]);
  expect(toldSince("b", from).filter((r) => !r.ok)).toEqual([]);
  expect(box.commerce.db.orders.get(ORDER_ID).state).toBe("complete");
  record = await readOrderParts(ORDER);
  expect([record.parts.erp.status, record.parts["brand-b"].status]).toEqual([
    "invoiced",
    "invoiced",
  ]);
}

describe("Pair in a box: only one ERP fulfils its part of a split order", () => {
  test("ERP A alone confirms, ships and invoices: Commerce gets a shipment and an invoice of A's line only, the order is not Complete, and ERP B hears nothing; then ERP B does the same and the order completes", async () => {
    await onlyAThenB(box.commerce.events.orderSaved(ORDER_ID, { isNew: true }));
  });

  // The ERP names each line by the Commerce item id it was sent. An order event whose lines
  // carry none used to send the ERP a null reference, and no shipment, invoice, credit memo
  // or return of that line could ever be matched to its Commerce line again.
  test("The same, from an order event whose lines carry no item ids: the ids are read from Commerce before anything is sent, and the journey is the same", async () => {
    const placed = box.commerce.events.orderSaved(ORDER_ID, { isNew: true });
    placed.data.value.items = placed.data.value.items.map(
      ({ item_id: _id, ...line }) => line,
    );
    await onlyAThenB(placed);
    const record = await readOrderParts(ORDER);
    expect([record.parts.erp.itemIds, record.parts["brand-b"].itemIds]).toEqual(
      [[1], [2]],
    );
  });
});
