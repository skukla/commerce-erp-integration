/*
 * Pair-in-a-box with two ERPs where an ERP owns the products sold on named websites (AB-64;
 * owner, 2026-10-02). A cart belongs to one website, so an order comes from exactly one, and
 * an ERP owning that website takes the whole order — unless another ERP owns a line by a
 * product rule (its attribute or inventory source), which beats the website rule. The website
 * ERP is that site's catch-all (router/ownership.js).
 *
 * Each ERP runs in this process with its own database; the integration's ERP client reaches
 * the one whose address a call carries (adapters/contract.js paramsForErp).
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
    request.params?.ERP_BASE_URL === ERP_B_URL
      ? erpB.call(action, request)
      : erpA.call(action, request);
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
vi.mock("#src/order/commerce-order-api-client", () => box.commerce.orderClient);

import { erp } from "#lib/erp";
import { replaceErps, resetErpsClient } from "#lib/erps";
import * as keyMap from "#lib/key-map";
import { readOrderParts } from "#lib/order-parts";
import * as orderCreated from "#src/order/commerce/created/index";

import { fillErp } from "./fill-erp.js";

const ERP_A_URL = "https://erp-a.example/api/v1/web/erp";
const ORDER = "000000042";
const ORDER_ID = 55;
/** The fake store's views: 1 is on website base, 2 on website eu. */
const STORE_ON_BASE = 1;
const STORE_ON_EU = 2;

/** The sales orders an in-process ERP holds for the Commerce order, by line SKU. */
async function linesIn(erpBox) {
  const res = await erpBox.call("orders");
  return res.data.items
    .filter((o) => o.purchaseOrderByCustomer === ORDER)
    .map((o) => o.lines.map((l) => l.sku));
}

/** Two ERPs listed and filled, each paired with company 7; A's and B's ownership as given. */
async function twoErps(settingsA, settingsB) {
  await replaceErps([
    {
      adapter: "demo-erp",
      connection: { baseUrl: ERP_A_URL },
      id: "erp",
      name: "ERP A",
      ...(settingsA ? { settings: settingsA } : {}),
    },
    {
      adapter: "demo-erp",
      connection: { baseUrl: box.ERP_B_URL },
      id: "brand-b",
      name: "ERP B",
      ...(settingsB ? { settings: settingsB } : {}),
    },
  ]);
  const paramsB = { ERP_BASE_URL: box.ERP_B_URL };
  await fillErp(
    box.commerce.lib,
    { importRecords: (_p, body) => erp.importRecords(paramsB, body) },
    "Box",
  );
  const partnerB = await keyMap.erpCustomerOf("7");
  await fillErp(box.commerce.lib, erp, "Box");
  await keyMap.pairCustomer("7", partnerB, "brand-b");
}

const place = () =>
  orderCreated.main(box.commerce.events.orderSaved(ORDER_ID, { isNew: true }));

beforeEach(() => {
  box.commerce.reset();
  box.erpA.reset();
  box.erpB.reset();
  box.state.reset();
  resetErpsClient(box.state);
  keyMap.resetKeyMapClient(box.state);
});

describe("Pair in a box: ERP A owns website base, ERP B owns website eu", () => {
  beforeEach(async () => {
    await twoErps(
      { structure_owns: "websites", structure_owns_websites: "base" },
      { structure_owns: "websites", structure_owns_websites: "eu" },
    );
    // B2 is sold on both websites: the ORDER's website decides where it goes, not the product's.
    box.commerce.db.products.get("B2").websites = ["base", "eu"];
  });

  test("an order from base goes whole to ERP A, as one part", async () => {
    box.commerce.db.orders.get(ORDER_ID).store_id = STORE_ON_BASE;
    const placed = await place();
    expect(placed.statusCode).toBe(200);
    expect(await linesIn(box.erpA)).toEqual([["A1", "B2"]]);
    expect(await linesIn(box.erpB)).toEqual([]);
    const record = await readOrderParts(ORDER);
    expect(Object.keys(record.parts)).toEqual(["erp"]);
    expect(record.parts.erp).toMatchObject({
      skus: ["A1", "B2"],
      status: "sent",
    });
    expect(record.unrouted).toEqual([]);
    expect(record.conflicts).toEqual([]);
  });

  test("the same order from eu goes whole to ERP B", async () => {
    box.commerce.db.orders.get(ORDER_ID).store_id = STORE_ON_EU;
    const placed = await place();
    expect(placed.statusCode).toBe(200);
    expect(await linesIn(box.erpB)).toEqual([["A1", "B2"]]);
    expect(await linesIn(box.erpA)).toEqual([]);
    const record = await readOrderParts(ORDER);
    expect(Object.keys(record.parts)).toEqual(["brand-b"]);
    expect(record.unrouted).toEqual([]);
  });
});

describe("Pair in a box: ERP A owns website base, ERP B owns products by attribute", () => {
  beforeEach(async () => {
    // B has no setting of its own: it owns the products whose erp_owner is brand-b.
    await twoErps({
      structure_owns: "websites",
      structure_owns_websites: "base",
    });
    box.commerce.db.products.get("B2").custom_attributes = {
      erp_owner: "brand-b",
    };
  });

  test("an order from base with one B-tagged line and one untagged line splits: B gets its line, A gets the rest", async () => {
    box.commerce.db.orders.get(ORDER_ID).store_id = STORE_ON_BASE;
    const placed = await place();
    expect(placed.statusCode).toBe(200);
    expect(await linesIn(box.erpA)).toEqual([["A1"]]);
    expect(await linesIn(box.erpB)).toEqual([["B2"]]);
    const record = await readOrderParts(ORDER);
    expect(record.parts.erp).toMatchObject({ skus: ["A1"], status: "sent" });
    expect(record.parts["brand-b"]).toMatchObject({
      skus: ["B2"],
      status: "sent",
    });
    expect(record.conflicts).toEqual([]);
    expect(record.unrouted).toEqual([]);
  });

  test("the same order from eu: B still gets its tagged line, and the untagged line belongs to no ERP and is held back", async () => {
    box.commerce.db.orders.get(ORDER_ID).store_id = STORE_ON_EU;
    const placed = await place();
    expect(placed.statusCode).toBe(200);
    expect(await linesIn(box.erpA)).toEqual([]);
    expect(await linesIn(box.erpB)).toEqual([["B2"]]);
    const record = await readOrderParts(ORDER);
    expect(Object.keys(record.parts)).toEqual(["brand-b"]);
    expect(record.unrouted).toEqual(["A1"]);
  });
});
