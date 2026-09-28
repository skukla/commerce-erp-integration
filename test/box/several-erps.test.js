/*
 * Pair-in-a-box with two ERPs in the integration's ERP list (design v1 §3.3): a Commerce
 * order whose lines belong to both is split into one part per ERP. Each ERP runs in this
 * process with its own database; the integration's ERP client reaches the one whose address
 * a call carries (adapters/contract.js paramsForErp sets ERP_BASE_URL per ERP).
 *
 * The second ERP can be switched off. "down" is a network failure: the real erpRequest
 * (lib/erp.js) lets fetch's rejection through, and Node's fetch rejects an unreachable host
 * with TypeError "fetch failed". "refusing" is an HTTP answer the send may not retry.
 */
const box = await vi.hoisted(async () => {
  const { createFakeCommerce } = await import("./fake-commerce.js");
  const { startErp } = await import("./erp-in-process.js");
  const { fakeState } = await import("./state.js");
  const { erpClientModule, settingsModule } = await import("./box-modules.js");
  const ERP_B_URL = "https://erp-b.example/api/v1/web/erp";
  const erpA = startErp();
  const erpB = startErp();
  const b = { mode: "up" };
  // Every create-order request each ERP was sent, reached or not.
  const creates = { a: [], b: [] };
  // Every request either ERP was sent: which ERP, the action, the method and the path.
  const requests = [];
  const isCreate = (action, request) =>
    action === "orders" && request.method === "POST" && !request.path;
  const call = (action, request = {}) => {
    const toB = request.params?.ERP_BASE_URL === ERP_B_URL;
    requests.push({
      action,
      method: request.method ?? "GET",
      path: request.path ?? "",
      to: toB ? "b" : "a",
    });
    if (isCreate(action, request)) {
      creates[toB ? "b" : "a"].push(request.body.commerceIncrementId);
    }
    if (!toB) {
      return erpA.call(action, request);
    }
    if (b.mode === "down") {
      return Promise.reject(new TypeError("fetch failed"));
    }
    if (b.mode === "refusing") {
      return Promise.resolve({ data: {}, ok: false, status: 401 });
    }
    return erpB.call(action, request);
  };
  return {
    b,
    commerce: createFakeCommerce(),
    creates,
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
vi.mock("#src/order/commerce-order-api-client", () => box.commerce.orderClient);

import { erp } from "#lib/erp";
import { replaceErps, resetErpsClient } from "#lib/erps";
import * as keyMap from "#lib/key-map";
import { listOrderPartsIds, readOrderParts } from "#lib/order-parts";
import * as detachAction from "#src/erp/detach/index";
import * as resendPartAction from "#src/erp/resend-part/index";
import * as statusAction from "#src/erp/status/index";
import * as orderChanged from "#src/order/commerce/changed/index";
import * as orderCreated from "#src/order/commerce/created/index";

import { fillErp } from "./fill-erp.js";

const ERP_A_URL = "https://erp-a.example/api/v1/web/erp";
const ORDER = "000000042";
const ORDER_ID = 55;
const IN_MAINTENANCE = /^ERP B is in maintenance until \d\d:\d\d UTC\.$/;

const statusOf = (res) => res.statusCode ?? res.error?.statusCode;
const statusComments = () =>
  box.commerce.writes.filter((w) => w.kind === "comment" && w.status);

/** The sales orders an in-process ERP holds for the Commerce order, read from its own database. */
async function erpOrdersFor(erpBox) {
  const res = await erpBox.call("orders");
  return res.data.items.filter((o) => o.commerceIncrementId === ORDER);
}

/**
 * Two ERPs listed, each filled with the store and paired with company 7, and each owning one
 * line of order 55 by the products' erp_owner attribute: A1 is ERP A's, B2 is ERP B's.
 */
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
  const paramsB = { ERP_BASE_URL: box.ERP_B_URL };
  await fillErp(
    box.commerce.lib,
    {
      importRecords: (_p, body) => erp.importRecords(paramsB, body),
    },
    "Box",
  );
  const partnerB = await keyMap.erpCustomerOf("7");
  // ERP A last: its fill replaces the key map with its own pair, then ERP B's is added.
  await fillErp(box.commerce.lib, erp, "Box");
  await keyMap.pairCustomer("7", partnerB, "brand-b");
  box.commerce.db.products.get("A1").custom_attributes = { erp_owner: "erp" };
  box.commerce.db.products.get("B2").custom_attributes = {
    erp_owner: "brand-b",
  };
}

const place = () =>
  orderCreated.main(box.commerce.events.orderSaved(ORDER_ID, { isNew: true }));
const resend = () =>
  resendPartAction.main({
    __ow_method: "post",
    erpId: "brand-b",
    incrementId: ORDER,
  });

beforeEach(async () => {
  box.commerce.reset();
  box.erpA.reset();
  box.erpB.reset();
  box.state.reset();
  box.b.mode = "up";
  resetErpsClient(box.state);
  keyMap.resetKeyMapClient(box.state);
  await twoErps();
  box.creates.a.length = 0;
  box.creates.b.length = 0;
});

describe("Pair in a box: an order split between two ERPs, one of them away", () => {
  test("ERP B unreachable: ERP A's part is sent, B's waits and the order is Partially Held; Re-send sends B's part once B is back, and nothing reaches ERP A twice", async () => {
    box.b.mode = "down";
    const placed = await place();
    // Held: I/O Events delivers the order event again later.
    expect(statusOf(placed)).toBe(503);

    const [inA] = await erpOrdersFor(box.erpA);
    expect((await erpOrdersFor(box.erpA)).length).toBe(1);
    expect(inA.lines.map((l) => l.sku)).toEqual(["A1"]);
    expect(await erpOrdersFor(box.erpB)).toEqual([]);
    let record = await readOrderParts(ORDER);
    expect(record.parts.erp).toMatchObject({
      erpNumber: inA.number,
      status: "sent",
    });
    expect(record.parts["brand-b"]).toMatchObject({
      skus: ["B2"],
      status: "held",
    });
    expect(record.parts["brand-b"].refused).toBeUndefined();

    const order = box.commerce.db.orders.get(ORDER_ID);
    expect([order.state, order.status]).toEqual(["new", "partially_held"]);
    expect(statusComments()).toEqual([
      {
        comment:
          "Partially Held: waiting on brand-b (held). The other parts go ahead.",
        kind: "comment",
        orderId: String(ORDER_ID),
        status: "partially_held",
      },
    ]);
    // A split order's ERP numbers are the parts', never the order's one field.
    expect(
      box.commerce.writes.filter((w) => w.kind === "setExtOrderId"),
    ).toEqual([]);

    // I/O Events retries while ERP B is still away: still held, and ERP A is not sent to again.
    expect(statusOf(await place())).toBe(503);
    expect((await erpOrdersFor(box.erpA)).length).toBe(1);
    expect(statusComments()).toHaveLength(1);

    // ERP B is back; staff press Re-send on its part.
    box.b.mode = "up";
    const resent = await resend();
    expect(resent.statusCode).toBe(200);
    expect(resent.body.outcome).toBe("sent");

    const inB = await erpOrdersFor(box.erpB);
    expect(inB).toHaveLength(1);
    expect(inB[0].lines.map((l) => l.sku)).toEqual(["B2"]);
    expect(await erpOrdersFor(box.erpA)).toEqual([inA]);
    record = await readOrderParts(ORDER);
    expect(record.parts["brand-b"]).toMatchObject({
      erpNumber: inB[0].number,
      status: "sent",
    });
    // No part waits: the order returns to its state's own status, with a note saying so.
    expect(box.commerce.db.orders.get(ORDER_ID).status).toBe("pending");
    expect(statusComments().at(-1)).toEqual({
      comment: "No part is waiting any more.",
      kind: "comment",
      orderId: String(ORDER_ID),
      status: "pending",
    });

    // A second press finds the part already with ERP B and sends nothing.
    const again = await resend();
    expect(again.body.outcome).toBe("skipped");
    expect(await erpOrdersFor(box.erpB)).toHaveLength(1);
    expect(await erpOrdersFor(box.erpA)).toHaveLength(1);
    // What the integration asked of each ERP: A once; B twice while away, then once more.
    expect(box.creates).toEqual({ a: [ORDER], b: [ORDER, ORDER, ORDER] });
  });

  test("ERP B refuses (HTTP 401): its part is failed and refused, the event is not retried, the order is Partially Held; Re-send is how it goes again", async () => {
    box.b.mode = "refusing";
    const placed = await place();
    // A refusal cannot be helped by delivering the event again; ERP A's part went.
    expect(statusOf(placed)).toBe(200);
    expect(await erpOrdersFor(box.erpA)).toHaveLength(1);
    expect((await readOrderParts(ORDER)).parts["brand-b"]).toMatchObject({
      refused: true,
      status: "failed",
    });
    expect(box.commerce.db.orders.get(ORDER_ID).status).toBe("partially_held");
    expect(statusComments().at(-1).comment).toBe(
      "Partially Held: waiting on brand-b (failed). The other parts go ahead.",
    );

    box.b.mode = "up";
    const resent = await resend();
    expect(resent.body.outcome).toBe("sent");
    expect(await erpOrdersFor(box.erpB)).toHaveLength(1);
    expect(await erpOrdersFor(box.erpA)).toHaveLength(1);
    const part = (await readOrderParts(ORDER)).parts["brand-b"];
    expect(part.status).toBe("sent");
    expect(part.refused).toBeUndefined();
    expect(box.commerce.db.orders.get(ORDER_ID).status).toBe("pending");
    expect(box.creates).toEqual({ a: [ORDER], b: [ORDER, ORDER] });
  });

  test("ERP B in maintenance (its own window, contract version 8): its part waits and the order is Partially Held; erp/status says B is in maintenance; once it ends, Re-send sends B's part once", async () => {
    // A deployed ERP always carries its name (ERP_DISPLAY_NAME); the list's name here.
    const started = await box.erpB.call("settings", {
      body: { minutes: 30 },
      method: "POST",
      params: { ERP_DISPLAY_NAME: "ERP B" },
      path: "/maintenance",
    });
    expect(started.status).toBe(200);
    const why = started.data.maintenance.message;
    expect(why).toMatch(IN_MAINTENANCE);

    // The ERP answers 503, which the send treats as an ERP that is away: the part waits.
    expect(statusOf(await place())).toBe(503);
    expect(await erpOrdersFor(box.erpA)).toHaveLength(1);
    expect((await readOrderParts(ORDER)).parts["brand-b"]).toMatchObject({
      status: "held",
    });
    expect(box.commerce.db.orders.get(ORDER_ID).status).toBe("partially_held");

    const status = await statusAction.main({ ERP_BASE_URL: ERP_A_URL });
    // Each listed ERP also carries its own figures for the Admin page's Overview, the real
    // ERP's health giving them during its maintenance window too.
    expect(status.body.erps).toMatchObject([
      { id: "erp", name: "ERP A", reachable: true },
      { error: why, id: "brand-b", name: "ERP B", reachable: false },
    ]);
    expect(status.body.erps[0].error).toBeUndefined();
    expect(status.body.erps[1].counts.products).toEqual(expect.any(Number));

    await box.erpB.call("settings", { method: "DELETE", path: "/maintenance" });
    const resent = await resend();
    expect(resent.body.outcome).toBe("sent");
    expect(await erpOrdersFor(box.erpB)).toHaveLength(1);
    expect(await erpOrdersFor(box.erpA)).toHaveLength(1);
    expect(box.commerce.db.orders.get(ORDER_ID).status).toBe("pending");
  });
});

/*
 * A reset closes every order the ERPs hold before it wipes them (AB-16n, owner 2026-09-28). The
 * box places three orders across the two ERPs, runs erp/detach with closeOrders as Demo Builder's
 * reset does, and then delivers every order save Commerce raised for the close to BOTH order
 * handlers, as I/O Events would: the cancellations must reach no ERP.
 */
describe("Pair in a box: a reset closes the orders the two ERPs hold", () => {
  const DAY = "2026-09-28";
  const CANCELLED = `Canceled by the demo reset on ${DAY}.`;
  const REMOVED = `The ERP documents for this order were removed by the demo reset on ${DAY}.`;
  const SPLIT = 55;
  const INVOICED = 56;
  const HELD = 57;

  /** Another order like 55, with only the lines of these SKUs. */
  function addOrder(id, skus) {
    const base = box.commerce.db.orders.get(SPLIT);
    box.commerce.db.orders.set(id, {
      ...structuredClone(base),
      entity_id: id,
      increment_id: `0000000${id}`,
      items: structuredClone(base.items.filter((i) => skus.includes(i.sku))),
    });
  }

  const placeOrder = (id) =>
    orderCreated.main(box.commerce.events.orderSaved(id, { isNew: true }));
  const notesOn = (id) =>
    box.commerce.writes
      .filter((w) => w.kind === "comment" && w.orderId === String(id))
      .map((w) => w.comment);
  const resetNotesOn = (id) =>
    notesOn(id).filter((c) => c.includes("by the demo reset on"));
  const closeAll = () =>
    detachAction.main({ closeOrders: true, ERP_BASE_URL: ERP_A_URL });

  /** Every order save Commerce raised since `from`, delivered to both order handlers. */
  async function deliverOrderSaves(from) {
    const answers = [];
    for (const event of box.commerce.orderSaves.slice(from)) {
      // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as raised
      const created = await orderCreated.main(structuredClone(event));
      const changed = await orderChanged.main(structuredClone(event));
      answers.push([statusOf(created), statusOf(changed)]);
    }
    return answers;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T15:00:00Z`));
  });
  afterEach(() => vi.useRealTimers());

  test("Then the open split order and the held order are cancelled with a note, the invoiced one only noted, no parts record is left, no ERP is sent anything, a second run changes nothing, and a fresh order routes to both ERPs", async () => {
    // The split order: A1 to ERP A, B2 to ERP B.
    expect(statusOf(await placeOrder(SPLIT))).toBe(200);
    // ERP A's order alone, then invoiced in Commerce.
    addOrder(INVOICED, ["A1"]);
    expect(statusOf(await placeOrder(INVOICED))).toBe(200);
    await box.commerce.adminInvoice(INVOICED);
    // ERP B's order alone, put on hold in Commerce, which ERP B is told.
    addOrder(HELD, ["B2"]);
    expect(statusOf(await placeOrder(HELD))).toBe(200);
    await box.commerce.adminHold(HELD);
    expect(
      statusOf(await orderChanged.main(box.commerce.events.orderSaved(HELD))),
    ).toBe(200);
    const [heldInB] = (await box.erpB.call("orders")).data.items.filter(
      (o) => o.commerceOrderId === String(HELD),
    );
    expect(heldInB.creditStatus).toBe("held");
    expect((await listOrderPartsIds()).sort()).toEqual([
      "000000042",
      "000000056",
      "000000057",
    ]);

    const sentBefore = box.requests.length;
    const savesBefore = box.commerce.orderSaves.length;
    const res = await closeAll();

    expect(res.statusCode).toBe(200);
    expect(res.body.closed).toEqual({
      alreadyClosed: 0,
      cancelled: 2,
      commented: 1,
      failed: [],
      partsRemoved: 3,
    });
    const orderOf = (id) => box.commerce.db.orders.get(id);
    expect(orderOf(SPLIT).state).toBe("canceled");
    expect(orderOf(HELD).state).toBe("canceled");
    expect(orderOf(INVOICED).state).toBe("complete");
    expect(resetNotesOn(SPLIT)).toEqual([CANCELLED]);
    expect(resetNotesOn(HELD)).toEqual([CANCELLED]);
    expect(resetNotesOn(INVOICED)).toEqual([REMOVED]);
    expect(await listOrderPartsIds()).toEqual([]);

    // The saves the close made: the release of the hold and the two cancels, at least.
    expect(box.commerce.orderSaves.length - savesBefore).toBeGreaterThanOrEqual(
      3,
    );
    const answers = await deliverOrderSaves(savesBefore);
    expect(answers.every(([a, b]) => a < 500 && b < 500)).toBe(true);
    // No ERP was asked to create, cancel, hold or release anything: the close and its events
    // only read the ERPs' order lists and orders.
    const since = box.requests.slice(sentBefore);
    expect(since.filter((r) => r.method !== "GET")).toEqual([]);
    expect(since.filter((r) => r.path.endsWith("/cancel"))).toEqual([]);
    // Nor did the events bring a parts record back.
    expect(await listOrderPartsIds()).toEqual([]);

    // A second run, before the ERPs are wiped, cancels nothing and notes nothing again.
    const notesBefore = box.commerce.writes.filter(
      (w) => w.kind === "comment",
    ).length;
    const again = await closeAll();
    expect(again.body.closed).toEqual({
      alreadyClosed: 3,
      cancelled: 0,
      commented: 0,
      failed: [],
      partsRemoved: 0,
    });
    expect(box.commerce.writes.filter((w) => w.kind === "comment").length).toBe(
      notesBefore,
    );

    // The reset wipes and refills both ERPs; a fresh split order then routes to both.
    box.erpA.reset();
    box.erpB.reset();
    await twoErps();
    box.creates.a.length = 0;
    box.creates.b.length = 0;
    addOrder(58, ["A1", "B2"]);
    expect(statusOf(await placeOrder(58))).toBe(200);
    expect(box.creates).toEqual({ a: ["000000058"], b: ["000000058"] });
    const fresh = await readOrderParts("000000058");
    expect(fresh.parts.erp.status).toBe("sent");
    expect(fresh.parts["brand-b"].status).toBe("sent");
  });
});
