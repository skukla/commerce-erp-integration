/*
 * Pair-in-a-box with two ERPs (AB-26y step 5, ERP contract version 19): a real ERP raises its
 * events for every change, including the ones this integration made in it for a change made in
 * Commerce. Each ERP's echo is recognised and dropped, per ERP: the two ERPs number their sales
 * orders alike (both hold this order as 0000001000), so an echo is known by the ERP it comes
 * from as well as by its document.
 *
 * Order 55 is split: A1 (line 1) is ERP A's, B2 (line 2) is ERP B's.
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
import * as orderChanged from "#src/order/commerce/changed/index";
import * as orderCreated from "#src/order/commerce/created/index";
import * as orderInvoiced from "#src/order/commerce/invoiced/index";
import * as orderShipped from "#src/order/commerce/shipped/index";

import { deliverErpEvents } from "./deliver-erp-events.js";
import { fillErp } from "./fill-erp.js";

const ERP_A_URL = "https://erp-a.example/api/v1/web/erp";
const ORDER = "000000042";
const ORDER_ID = 55;

const statusOf = (res) => res.statusCode ?? res.error?.statusCode;
const writesOf = (kind) => box.commerce.writes.filter((w) => w.kind === kind);
const salesOrderIn = async (erpBox) =>
  (await erpBox.call("orders")).data.items.find(
    (o) => o.purchaseOrderByCustomer === ORDER,
  );
const raised = async (erpBox) =>
  (await erpBox.pendingEvents()).map((e) => e.type);

/** Deliver both ERPs' events; every one must be an echo, so no handler runs. */
async function onlyEchoes(type) {
  expect([await raised(box.erpA), await raised(box.erpB)]).toEqual([
    [type],
    [type],
  ]);
  expect(await deliverErpEvents(box.erpA, { erpId: "erp" })).toEqual([]);
  expect(await deliverErpEvents(box.erpB, { erpId: "brand-b" })).toEqual([]);
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

describe("Pair in a box: Commerce Admin moves a split order, and both ERPs raise them", () => {
  test("A hold, its release, one shipment of both lines and the invoice made in Commerce each reach both ERPs; each ERP's echo is dropped, and Commerce holds one of each", async () => {
    expect(
      statusOf(
        await orderCreated.main(
          box.commerce.events.orderSaved(ORDER_ID, { isNew: true }),
        ),
      ),
    ).toBe(200);
    const [inA, inB] = [
      await salesOrderIn(box.erpA),
      await salesOrderIn(box.erpB),
    ];
    // The two ERPs number alike: the same sales order number for different lines.
    expect(inA.number).toBe(inB.number);

    await box.commerce.adminHold(ORDER_ID);
    expect(
      statusOf(
        await orderChanged.main(box.commerce.events.orderSaved(ORDER_ID)),
      ),
    ).toBe(200);
    await onlyEchoes("SalesOrder.Changed");
    await box.commerce.orderClient.unholdOrder({}, ORDER_ID);
    expect(
      statusOf(
        await orderChanged.main(box.commerce.events.orderSaved(ORDER_ID)),
      ),
    ).toBe(200);
    await onlyEchoes("SalesOrder.Changed");

    const shipmentId = box.commerce.adminShip(ORDER_ID, [
      { order_item_id: 1, qty: 12 },
      { order_item_id: 2, qty: 4 },
    ]);
    expect(
      statusOf(
        await orderShipped.main(box.commerce.events.shipmentSaved(shipmentId)),
      ),
    ).toBe(200);
    await onlyEchoes("OutboundDelivery.GoodsIssueStatusChanged");

    const invoiceId = await box.commerce.adminInvoice(ORDER_ID);
    expect(
      statusOf(
        await orderInvoiced.main(box.commerce.events.invoiceSaved(invoiceId)),
      ),
    ).toBe(200);
    await onlyEchoes("BillingDocument.Created");

    expect(
      ["hold", "unhold", "ship", "invoice", "cancel"].map(
        (kind) => writesOf(kind).length,
      ),
    ).toEqual([1, 1, 1, 1, 0]);
    expect([
      (await salesOrderIn(box.erpA)).status,
      (await salesOrderIn(box.erpB)).status,
    ]).toEqual(["invoiced", "invoiced"]);
  });
});
