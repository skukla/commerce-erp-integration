/*
 * Pair-in-a-box: Repeat order (AB-26r; ERP contract version 19). A canceled order is terminal
 * in both systems; the way back is a NEW sales order the ERP makes from the canceled one. The
 * web shop never had that order, so the integration publishes nothing for it and creates no
 * Commerce order: every one of its events is answered and ends there.
 */
const box = await vi.hoisted(async () => {
  const { createFakeCommerce } = await import("./fake-commerce.js");
  const { startErp } = await import("./erp-in-process.js");
  const { fakeState } = await import("./state.js");
  const { erpClientModule, settingsModule } = await import("./box-modules.js");
  const erpBox = startErp();
  return {
    commerce: createFakeCommerce(),
    erp: erpBox,
    erpClient: erpClientModule(erpBox.call),
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
import * as keyMap from "#lib/key-map";
import * as ledger from "#lib/ledger";
import { splitExtOrderId } from "#lib/structure";
import * as orderCreated from "#src/order/commerce/created/index";

import { deliverErpEvents } from "./deliver-erp-events.js";
import { fillErp } from "./fill-erp.js";

const writesOf = (kind) => box.commerce.writes.filter((w) => w.kind === kind);
const post = (path, body) =>
  box.erp.call("orders", { body, method: "POST", path });

beforeEach(() => {
  box.commerce.reset();
  box.erp.reset();
  box.state.reset();
  ledger.resetLedgerClient(box.state);
  keyMap.resetKeyMapClient(box.state);
});

describe("Pair in a box: Repeat order", () => {
  test("An order canceled in the ERP is canceled in Commerce once; its repeat is confirmed, shipped and invoiced in the ERP, and Commerce hears nothing of it", async () => {
    await fillErp(box.commerce.lib, erp, "Box");
    await orderCreated.main(
      box.commerce.events.orderSaved(55, { isNew: true }),
    );
    const { number } = splitExtOrderId(
      box.commerce.db.orders.get(55).ext_order_id,
    );
    await post(`/${number}/cancel`, { reason: "Customer request" });
    expect(
      (await deliverErpEvents(box.erp)).map((d) => [d.event, d.status]),
    ).toEqual([["be-observer.sales_order_cancel", 200]]);
    expect(box.commerce.db.orders.get(55).state).toBe("canceled");
    const before = box.commerce.writes.length;

    const repeat = await post(`/${number}/repeat`);
    expect(repeat.status).toBe(201);
    const again = repeat.data.number;
    expect(repeat.data.purchaseOrderByCustomer).toBeNull();
    await post(`/${again}/confirm`);
    await post(`/${again}/status`, { status: "shipped" });
    await post(`/${again}/invoice`);
    const raised = (await box.erp.pendingEvents()).map((e) => e.type);
    expect(raised).toEqual([
      "SalesOrder.Changed",
      "OutboundDelivery.GoodsIssueStatusChanged",
      "BillingDocument.Created",
    ]);

    // Every event answered 200 by the webhook and handed to no handler.
    expect(await deliverErpEvents(box.erp)).toEqual([]);
    expect(await box.erp.pendingEvents()).toEqual([]);
    expect(box.commerce.writes.slice(before)).toEqual([]);
    expect(writesOf("cancel")).toHaveLength(1);
    expect(box.commerce.db.orders.size).toBe(1);
    expect(box.commerce.db.orders.get(55).state).toBe("canceled");
    // The ERP keeps both, each naming the other.
    const original = (await erp.order({}, number)).data;
    expect([original.status, original.repeatedAs]).toEqual(["canceled", again]);
    expect((await erp.order({}, again)).data.status).toBe("invoiced");
  });
});
