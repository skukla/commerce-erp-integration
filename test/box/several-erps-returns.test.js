/*
 * Pair-in-a-box with two ERPs: a return over both ERPs' lines (returns-design.md §3.1; build
 * slices D and E, "done when"). Order 55 is split: A1 (line 1) is ERP A's, B2 (line 2) is ERP
 * B's. Both invoice their parts; the buyer returns a line of each; each ERP is sent a return
 * order of only its line, once; ERP B receives and credits its line, and Commerce makes one
 * credit memo of exactly that line, and none more when the event is delivered again.
 *
 * Each ERP's events name it (ERP_ID, contract version 4): the two ERPs number their sales
 * orders alike, so the number alone cannot say whose part an event is about. A deployed ERP
 * names itself as its CloudEvent's source (/erp/<ERP_ID>, its lib/events.js `envelope`), and
 * the translation puts the id on the payload the handlers read (#src/ingestion/translate);
 * the box delivers through both.
 */
const box = await vi.hoisted(async () => {
  const { createFakeCommerce } = await import("./fake-commerce.js");
  const { startErp } = await import("./erp-in-process.js");
  const { fakeState } = await import("./state.js");
  const { erpClientModule, settingsModule } = await import("./box-modules.js");
  const ERP_B_URL = "https://erp-b.example/api/v1/web/erp";
  const erpA = startErp();
  const erpB = startErp();
  const call = (action, request = {}) =>
    (request.params?.ERP_BASE_URL === ERP_B_URL ? erpB : erpA).call(
      action,
      request,
    );
  return {
    commerce: createFakeCommerce(),
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
import { readOrderReturn } from "#lib/order-returns";
import * as orderCreated from "#src/order/commerce/created/index";
import * as returnSaved from "#src/order/commerce/return-saved/index";
import * as erpCreditMemo from "#src/order/external/creditmemo-created/index";

import { deliverErpEvents as deliverThrough } from "./deliver-erp-events.js";
import { fillErp } from "./fill-erp.js";

const ERP_A_URL = "https://erp-a.example/api/v1/web/erp";
const ORDER = "000000042";
const ORDER_ID = 55;

/**
 * Deliver one ERP's pending events through the ingestion webhook's translation
 * (deliver-erp-events.js), the ERP deployed with this id; answers each handler run.
 */
async function deliver(erpBox, erpId) {
  return (await deliverThrough(erpBox, { erpId })).map(
    ({ event, params, status, why }) => ({ event, params, status, why }),
  );
}

const writesOf = (kind) => box.commerce.writes.filter((w) => w.kind === kind);
const salesOrderIn = async (erpBox) =>
  (await erpBox.call("orders")).data.items.find(
    (o) => o.purchaseOrderByCustomer === ORDER,
  );

/** Confirm, ship and invoice a sales order in one ERP, and deliver what it raised. */
async function invoiceIn(erpBox, erpId) {
  const { number } = await salesOrderIn(erpBox);
  await erpBox.call("orders", { method: "POST", path: `/${number}/confirm` });
  await erpBox.call("orders", {
    body: { status: "shipped" },
    method: "POST",
    path: `/${number}/status`,
  });
  await erpBox.call("orders", { method: "POST", path: `/${number}/invoice` });
  return deliver(erpBox, erpId);
}

beforeEach(async () => {
  box.commerce.reset();
  box.erpA.reset();
  box.erpB.reset();
  box.state.reset();
  resetErpsClient(box.state);
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
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
});

describe("Pair in a box: a return over two ERPs' lines", () => {
  test("Each ERP gets a return order of only its line, once; ERP B's credit becomes one Commerce credit memo of its line, and a redelivery makes none", async () => {
    expect(
      (
        await orderCreated.main(
          box.commerce.events.orderSaved(ORDER_ID, { isNew: true }),
        )
      ).statusCode,
    ).toBe(200);
    const statuses = (ds) => ds.map((d) => [d.event, d.status, d.why]);
    for (const [erpBox, erpId] of [
      [box.erpA, "erp"],
      [box.erpB, "brand-b"],
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: one ERP after the other, as staff would
      expect(statuses(await invoiceIn(erpBox, erpId))).toEqual([
        ["be-observer.sales_order_status_update", 200, undefined],
        ["be-observer.sales_order_shipment_create", 200, undefined],
        ["be-observer.sales_order_invoice_create", 200, undefined],
      ]);
    }
    // Each ERP's invoice became a partial Commerce invoice of its own line.
    expect(writesOf("invoice").map((w) => w.items)).toEqual([
      [{ order_item_id: 1, qty: 12 }],
      [{ order_item_id: 2, qty: 4 }],
    ]);

    const returnId = box.commerce.adminCreateReturn(ORDER_ID, [
      { order_item_id: 1, qty: 3 },
      { order_item_id: 2, qty: 1 },
    ]);
    const sent = await returnSaved.main(
      box.commerce.events.returnSaved(returnId),
    );
    expect(sent).toMatchObject({ statusCode: 200 });
    // A later save (the integration's own status write) sends nothing new.
    await returnSaved.main(box.commerce.events.returnSaved(returnId));

    const [inA] = (await box.erpA.call("returns")).data.items;
    const [inB] = (await box.erpB.call("returns")).data.items;
    expect((await box.erpA.call("returns")).data.items).toHaveLength(1);
    expect((await box.erpB.call("returns")).data.items).toHaveLength(1);
    expect(inA.lines.map((l) => [l.customerLineReference, l.qty])).toEqual([
      ["1", 3],
    ]);
    expect(inB.lines.map((l) => [l.customerLineReference, l.qty])).toEqual([
      ["2", 1],
    ]);
    expect(inA.orderNumber).toBe((await salesOrderIn(box.erpA)).number);
    expect(inB.orderNumber).toBe((await salesOrderIn(box.erpB)).number);
    const record = await readOrderReturn(returnId);
    expect([
      record.pieces.erp.returnNumber,
      record.pieces["brand-b"].returnNumber,
    ]).toEqual([inA.number, inB.number]);
    expect(box.commerce.db.returns.get(returnId).status).toBe("authorized");

    // ERP B receives its goods and credits them; ERP A has done nothing yet.
    await box.erpB.call("returns", {
      method: "POST",
      path: `/${inB.number}/receive`,
    });
    await deliver(box.erpB, "brand-b");
    await box.erpB.call("returns", {
      method: "POST",
      path: `/${inB.number}/credit-memo`,
    });
    const [credited] = await deliver(box.erpB, "brand-b");

    expect(credited).toMatchObject({
      event: "be-observer.sales_order_creditmemo_create",
      status: 200,
    });
    expect(writesOf("refund").map((w) => [w.items, w.comment])).toEqual([
      [
        [{ order_item_id: 2, qty: 1 }],
        `Credited in ERP B (credit memo ${credited.params.data.creditMemoNumber})`,
      ],
    ]);
    const rma = box.commerce.db.returns.get(returnId);
    expect(rma.items.map((i) => i.status)).toEqual(["authorized", "approved"]);
    expect(rma.status).toBe("received_on_item");

    expect((await erpCreditMemo.main(credited.params)).statusCode).toBe(200);
    expect(writesOf("refund")).toHaveLength(1);
  });
});
