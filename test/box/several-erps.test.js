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
  const isCreate = (action, request) =>
    action === "orders" && request.method === "POST" && !request.path;
  const call = (action, request = {}) => {
    const toB = request.params?.ERP_BASE_URL === ERP_B_URL;
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
import { readOrderParts } from "#lib/order-parts";
import * as resendPartAction from "#src/erp/resend-part/index";
import * as orderCreated from "#src/order/commerce/created/index";

import { fillErp } from "./fill-erp.js";

const ERP_A_URL = "https://erp-a.example/api/v1/web/erp";
const ORDER = "000000042";
const ORDER_ID = 55;

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
});
