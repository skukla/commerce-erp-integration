/*
 * Shipments and invoices per part (design v1 §3.3, slice B4): with several ERPs each ERP
 * invoices and ships only its own lines, an invoice comes before its shipment, and invoice
 * calls on one order run one at a time.
 */
/*
 * Commerce's order as the invoice step reads it: nothing invoiced yet, unless a test hands its
 * own `getOrder` (a card captured at checkout invoiced the order in Commerce already).
 */
vi.mock("#src/order/commerce-order-api-client", () => ({
  getInvoice: vi.fn(),
  getOrder: vi.fn(async () => ({
    items: [
      { item_id: 1, qty_ordered: 3, sku: "CAB1" },
      { item_id: 2, qty_ordered: 5, sku: "SIGN1" },
    ],
  })),
  invoiceOrderItems: vi.fn(),
}));

import {
  readOrderParts,
  resetOrderPartsClient,
  writeOrderParts,
} from "#lib/order-parts";
import { resetOwnWritesClient } from "#lib/own-writes";
import { applyCombinedStatus } from "#router/combined-status";
import {
  fulfilmentFromCommerce,
  invoicePart,
  prepareShipment,
  recordShipped,
} from "#router/part-fulfilment";

import { fakeState } from "../box/state.js";

/* A change sent to the ERP is remembered in State so its echo is known (lib/own-writes.js). */
beforeEach(() => resetOwnWritesClient(fakeState()));
afterEach(() => resetOwnWritesClient());

function memoryState() {
  const store = new Map();
  return {
    delete: vi.fn(async (k) => store.delete(k)),
    get: vi.fn(async (k) =>
      store.has(k) ? { value: store.get(k) } : undefined,
    ),
    put: vi.fn(async (k, v) => store.set(k, v)),
    store,
  };
}

const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "brand-a",
    name: "Brand A ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "brand-b",
    name: "Brand B ERP",
  },
];
const ORDER = "000000042";
const ORDER_ID = 55;

/** A routed order: Brand A owns item 1 (cabinet), Brand B owns item 2 (sign). */
async function routed() {
  await writeOrderParts(ORDER, {
    conflicts: [],
    parts: {
      "brand-a": {
        erpNumber: "A-100",
        itemIds: [1],
        skus: ["CAB1"],
        status: "sent",
      },
      "brand-b": {
        erpNumber: "B-200",
        itemIds: [2],
        skus: ["SIGN1"],
        status: "sent",
      },
    },
    unrouted: [],
  });
}

const message = (erpId, erpNumber, items) => ({
  erpId,
  erpNumber,
  incrementId: ORDER,
  items,
  orderId: ORDER_ID,
});

let state;
beforeEach(async () => {
  state = memoryState();
  resetOrderPartsClient(state);
  await routed();
});

describe("Given an ERP invoices its part", () => {
  test("Then Commerce gets a partial invoice of that ERP's lines only, and a repeat invoices nothing", async () => {
    const invoiceItems = vi.fn(async () => 901);
    const deps = { erps: ERPS, invoiceItems };
    const msg = message("brand-a", "A-100", [
      { orderItemId: 1, qty: 3, sku: "CAB1" },
      { orderItemId: 2, qty: 5, sku: "SIGN1" },
    ]);

    const first = await invoicePart({}, ORDER_ID, msg, deps);
    expect(first).toMatchObject({ matched: true });
    expect(invoiceItems).toHaveBeenCalledExactlyOnceWith({}, ORDER_ID, [
      { order_item_id: 1, qty: 3 },
    ]);
    expect((await readOrderParts(ORDER)).parts["brand-a"].invoiced).toEqual({
      1: 3,
    });

    await invoicePart({}, ORDER_ID, msg, deps);
    expect(invoiceItems).toHaveBeenCalledTimes(1);
  });

  test("Then with one ERP nothing is done here (the whole-order invoice stays the handler's)", async () => {
    const invoiceItems = vi.fn();
    const one = await invoicePart(
      {},
      ORDER_ID,
      message("brand-a", "A-100", []),
      {
        erps: [ERPS[0]],
        invoiceItems,
      },
    );
    expect(one).toBeNull();
    expect(invoiceItems).not.toHaveBeenCalled();
  });

  // An invoice with no line of the part invoiced nothing, yet the part was then recorded as
  // invoiced: refused instead, so the ERP's journal says why.
  test.each([
    ["names no lines", []],
    ["names only another ERP's line", [{ orderItemId: 2, qty: 5 }]],
  ])(
    "Then an invoice that %s is refused with the reason and invoices nothing",
    async (_words, items) => {
      const invoiceItems = vi.fn();
      const res = await invoicePart(
        {},
        ORDER_ID,
        message("brand-a", "A-100", items),
        { erps: ERPS, invoiceItems },
      );
      expect(res).toEqual({
        matched: false,
        reason:
          "order 000000042: the invoice names no line of Brand A ERP's part; nothing was invoiced in Commerce",
      });
      expect(invoiceItems).not.toHaveBeenCalled();
    },
  );

  test("Then a message for no part is refused with the reason", async () => {
    const res = await invoicePart({}, ORDER_ID, message("brand-z", "Z-1", []), {
      erps: ERPS,
      invoiceItems: vi.fn(),
    });
    expect(res).toMatchObject({ matched: false });
  });
});

/** Commerce's order with some of each line invoiced already (at checkout, or in Admin). */
const invoicedInCommerce = (one, two) => async () => ({
  items: [
    { item_id: 1, qty_invoiced: one, qty_ordered: 3, sku: "CAB1" },
    { item_id: 2, qty_invoiced: two, qty_ordered: 5, sku: "SIGN1" },
  ],
});

describe("Given Commerce already invoiced a part's lines (a card captured at checkout)", () => {
  test("Then the ERP's invoice invoices nothing in Commerce, the part's lines read invoiced, and the lines Commerce had are named", async () => {
    const invoiceItems = vi.fn();
    const res = await invoicePart(
      {},
      ORDER_ID,
      message("brand-a", "A-100", [{ orderItemId: 1, qty: 3, sku: "CAB1" }]),
      { erps: ERPS, getOrder: invoicedInCommerce(3, 5), invoiceItems },
    );
    expect(invoiceItems).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      before: [{ order_item_id: 1, qty: 3, sku: "CAB1" }],
      erpName: "Brand A ERP",
      invoiced: [],
      matched: true,
    });
    expect((await readOrderParts(ORDER)).parts["brand-a"].invoiced).toEqual({
      1: 3,
    });
  });

  test("Then with some of a line invoiced already, only the rest is invoiced", async () => {
    const invoiceItems = vi.fn(async () => 903);
    const res = await invoicePart(
      {},
      ORDER_ID,
      message("brand-b", "B-200", [{ orderItemId: 2, qty: 5, sku: "SIGN1" }]),
      { erps: ERPS, getOrder: invoicedInCommerce(0, 2), invoiceItems },
    );
    expect(invoiceItems).toHaveBeenCalledExactlyOnceWith({}, ORDER_ID, [
      { order_item_id: 2, qty: 3 },
    ]);
    expect(res.before).toEqual([{ order_item_id: 2, qty: 2, sku: "SIGN1" }]);
    expect((await readOrderParts(ORDER)).parts["brand-b"].invoiced).toEqual({
      2: 5,
    });
  });

  test("Then a shipment before the invoice invoices nothing either, and the invoice after it still names what Commerce had", async () => {
    const invoiceItems = vi.fn();
    const deps = {
      erps: ERPS,
      getOrder: invoicedInCommerce(3, 5),
      invoiceItems,
    };
    const msg = message("brand-a", "A-100", [
      { orderItemId: 1, qty: 3, sku: "CAB1" },
    ]);
    const shipped = await prepareShipment(
      {},
      ORDER_ID,
      msg,
      { items: [{ order_item_id: 1, qty: 3 }] },
      deps,
    );
    expect(shipped).toMatchObject({
      items: [{ order_item_id: 1, qty: 3 }],
      matched: true,
    });
    const invoiced = await invoicePart({}, ORDER_ID, msg, deps);
    expect(invoiceItems).not.toHaveBeenCalled();
    expect(invoiced.before).toEqual([
      { order_item_id: 1, qty: 3, sku: "CAB1" },
    ]);
  });
});

describe("Given two invoice messages for one order at once", () => {
  test("Then they run one at a time: the second waits for the first, and each is invoiced once", async () => {
    let inFlight = 0;
    let most = 0;
    const invoiceItems = vi.fn(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return 1;
    });
    const deps = {
      erps: ERPS,
      invoiceItems,
      wait: () => new Promise((r) => setTimeout(r, 10)),
    };
    await Promise.all([
      invoicePart(
        {},
        ORDER_ID,
        message("brand-a", "A-100", [{ orderItemId: 1, qty: 3 }]),
        deps,
      ),
      invoicePart(
        {},
        ORDER_ID,
        message("brand-b", "B-200", [{ orderItemId: 2, qty: 5 }]),
        deps,
      ),
    ]);
    expect(most).toBe(1);
    expect(invoiceItems).toHaveBeenCalledTimes(2);
    const { parts } = await readOrderParts(ORDER);
    expect(parts["brand-a"].invoiced).toEqual({ 1: 3 });
    expect(parts["brand-b"].invoiced).toEqual({ 2: 5 });
  });

  test("Then a lock that stays taken answers busy, so the event is delivered again (never lost)", async () => {
    state.store.set(
      "order-invoice-lock-000000042",
      JSON.stringify({ token: "someone-else", until: Date.now() + 60_000 }),
    );
    const invoiceItems = vi.fn();
    const res = await invoicePart(
      {},
      ORDER_ID,
      message("brand-a", "A-100", [{ orderItemId: 1, qty: 3 }]),
      { attempts: 2, erps: ERPS, invoiceItems, wait: () => Promise.resolve() },
    );
    expect(res).toMatchObject({ busy: true });
    expect(invoiceItems).not.toHaveBeenCalled();
  });
});

describe("Given an ERP ships its part", () => {
  test("Then the shipment carries only that part's lines, and a shipment before its invoice invoices first", async () => {
    const invoiceItems = vi.fn(async () => 1);
    const prep = await prepareShipment(
      {},
      ORDER_ID,
      message("brand-b", "B-200", [{ orderItemId: 2, qty: 5 }]),
      {
        items: [
          { order_item_id: 2, qty: 5 },
          { order_item_id: 1, qty: 3 },
        ],
      },
      { erps: ERPS, invoiceItems },
    );
    expect(prep).toMatchObject({
      items: [{ order_item_id: 2, qty: 5 }],
      matched: true,
    });
    expect(invoiceItems).toHaveBeenCalledExactlyOnceWith({}, ORDER_ID, [
      { order_item_id: 2, qty: 5 },
    ]);

    await recordShipped(ORDER, prep.erpId, prep.items);
    expect((await readOrderParts(ORDER)).parts["brand-b"].shipped).toEqual({
      2: 5,
    });
  });

  test("Then a part already invoiced ships without a second invoice", async () => {
    const invoiceItems = vi.fn(async () => 1);
    const deps = { erps: ERPS, invoiceItems };
    await invoicePart(
      {},
      ORDER_ID,
      message("brand-a", "A-100", [{ orderItemId: 1, qty: 3 }]),
      deps,
    );
    await prepareShipment(
      {},
      ORDER_ID,
      message("brand-a", "A-100", [{ orderItemId: 1, qty: 3 }]),
      { items: [{ order_item_id: 1, qty: 3 }] },
      deps,
    );
    expect(invoiceItems).toHaveBeenCalledTimes(1);
  });

  // An empty item list never reaches Commerce's ship call.
  test("Then a shipment with no line of the part is refused with the reason: nothing is invoiced, and no empty list is handed on", async () => {
    const invoiceItems = vi.fn();
    const prep = await prepareShipment(
      {},
      ORDER_ID,
      message("brand-a", "A-100", [{ orderItemId: 2, qty: 5 }]),
      { items: [{ order_item_id: 2, qty: 5 }] },
      { erps: ERPS, invoiceItems },
    );
    expect(prep).toEqual({
      matched: false,
      reason:
        "order 000000042: the shipment names no line of Brand A ERP's part; nothing was shipped in Commerce",
    });
    expect(invoiceItems).not.toHaveBeenCalled();
  });

  test("Then with one ERP the shipment is left exactly as it was", async () => {
    expect(
      await prepareShipment(
        {},
        ORDER_ID,
        message("erp", "1", []),
        { items: [{ order_item_id: 1, qty: 1 }] },
        {
          erps: [ERPS[0]],
          invoiceItems: vi.fn(),
        },
      ),
    ).toBeNull();
  });
});

describe("Given Commerce ships or invoices lines of two ERPs' parts", () => {
  test("Then each ERP is told only its own lines, at its own address", async () => {
    const ship = vi.fn(async () => ({ data: {}, ok: true, status: 200 }));
    const erp = { fromCommerce: { invoice: vi.fn(), ship } };
    const res = await fulfilmentFromCommerce(
      {},
      "shipment",
      {
        entity_id: 7,
        items: [
          { order_item_id: 1, qty: 3 },
          { order_item_id: 2, qty: 5 },
        ],
        order_id: ORDER_ID,
      },
      { erp, erps: ERPS, getOrder: async () => ({ increment_id: ORDER }) },
    );
    // The Admin page's Activity names the ERPs told, and opens the order's trace.
    expect(res).toMatchObject({
      erpIds: ["brand-a", "brand-b"],
      orderRef: ORDER,
      outcome: "sent",
    });
    expect(ship).toHaveBeenCalledTimes(2);
    const [aParams, aNumber, aBody] = ship.mock.calls[0];
    expect(aParams.ERP_BASE_URL).toBe("https://a.example");
    expect(aNumber).toBe("A-100");
    expect(aBody.lines).toEqual([{ customerLineReference: "1", qty: 3 }]);
    const [bParams, bNumber, bBody] = ship.mock.calls[1];
    expect(bParams.ERP_BASE_URL).toBe("https://b.example");
    expect(bNumber).toBe("B-200");
    expect(bBody.lines).toEqual([{ customerLineReference: "2", qty: 5 }]);
  });

  // Live on Justrite 2026-10-02: Commerce's shipment event lists a configurable's child line
  // beside its parent, and the router's part holds both ids; the ERP's sales order holds only
  // the parent, so it answered 400 "Commerce order item 55 is not on this order" to every
  // echo of its own shipment, and the event was delivered again for hours.
  test("Then a configurable's child line is left out: the ERP's sales order holds the parent", async () => {
    await writeOrderParts(ORDER, {
      conflicts: [],
      parts: {
        "brand-b": {
          erpNumber: "B-200",
          itemIds: [2, 3],
          skus: ["SIGN1"],
          status: "sent",
        },
      },
      unrouted: [],
    });
    const ship = vi.fn(async () => ({ data: {}, ok: true, status: 200 }));
    const erp = { fromCommerce: { invoice: vi.fn(), ship } };
    await fulfilmentFromCommerce(
      {},
      "shipment",
      {
        entity_id: 7,
        items: [
          { order_item_id: 2, qty: 5 },
          { order_item_id: 3, qty: 5 },
        ],
        order_id: ORDER_ID,
      },
      {
        erp,
        erps: ERPS,
        getOrder: async () => ({
          increment_id: ORDER,
          items: [{ item_id: 2 }, { item_id: 3, parent_item_id: 2 }],
        }),
      },
    );
    expect(ship).toHaveBeenCalledTimes(1);
    expect(ship.mock.calls[0][2].lines).toEqual([
      { customerLineReference: "2", qty: 5 },
    ]);
  });

  test("Then an ERP that refuses the lines for good ends the delivery with its reason; one that is down is asked again", async () => {
    const refusing = {
      fromCommerce: {
        invoice: vi.fn(),
        ship: vi.fn(async () => ({
          data: { errorMessage: "Commerce order item 9 is not on this order." },
          ok: false,
          status: 400,
        })),
      },
    };
    const shipment = {
      entity_id: 7,
      items: [{ order_item_id: 2, qty: 5 }],
      order_id: ORDER_ID,
    };
    const getOrder = async () => ({ increment_id: ORDER });
    const refused = await fulfilmentFromCommerce({}, "shipment", shipment, {
      erp: refusing,
      erps: ERPS,
      getOrder,
    });
    expect(refused).toMatchObject({ outcome: "dropped", statusCode: 400 });
    expect(refused.message).toContain(
      "Commerce order item 9 is not on this order.",
    );

    const down = {
      fromCommerce: {
        invoice: vi.fn(),
        ship: vi.fn(async () => ({ data: {}, ok: false, status: 503 })),
      },
    };
    const held = await fulfilmentFromCommerce({}, "shipment", shipment, {
      erp: down,
      erps: ERPS,
      getOrder,
    });
    expect(held).toMatchObject({ outcome: "held", statusCode: 503 });
  });

  test("Then an invoice covering one ERP's lines goes to that ERP only", async () => {
    const invoice = vi.fn(async () => ({ data: {}, ok: true, status: 200 }));
    const erp = { fromCommerce: { invoice, ship: vi.fn() } };
    const res = await fulfilmentFromCommerce(
      {},
      "invoice",
      {
        entity_id: 9,
        items: [{ order_item_id: 2, qty: 5 }],
        order_id: ORDER_ID,
      },
      { erp, erps: ERPS, getOrder: async () => ({ increment_id: ORDER }) },
    );
    expect(res.erpIds).toStrictEqual(["brand-b"]);
    expect(invoice).toHaveBeenCalledTimes(1);
    expect(invoice.mock.calls[0][1]).toBe("B-200");
  });

  // Live on Justrite 2026-10-02: the Invoice Saved event names no lines (its subscription
  // asks for none), "no lines" was read as "the whole order", and ERP A's partial invoice was
  // told to ERP B, which had not confirmed and refused it.
  test("Then an invoice event that names no lines is read from Commerce, and only the ERP whose lines it covers is told", async () => {
    const invoice = vi.fn(async () => ({ data: {}, ok: true, status: 200 }));
    const erp = { fromCommerce: { invoice, ship: vi.fn() } };
    const getInvoice = vi.fn(async () => ({
      entity_id: 9,
      items: [{ order_item_id: 1, qty: 3 }],
      order_id: ORDER_ID,
    }));
    const res = await fulfilmentFromCommerce(
      { some: "param" },
      "invoice",
      { entity_id: 9, increment_id: "5000000023", order_id: ORDER_ID },
      {
        erp,
        erps: ERPS,
        getInvoice,
        getOrder: async () => ({ increment_id: ORDER }),
      },
    );
    expect(getInvoice).toHaveBeenCalledWith({ some: "param" }, 9);
    expect(res).toMatchObject({ erpIds: ["brand-a"], outcome: "sent" });
    expect(invoice).toHaveBeenCalledTimes(1);
    expect(invoice.mock.calls[0][0].ERP_BASE_URL).toBe("https://a.example");
    expect(invoice.mock.calls[0][1]).toBe("A-100");
  });

  test("Then an invoice with no lines in Commerce either is told to no ERP, never to all of them", async () => {
    const invoice = vi.fn();
    const res = await fulfilmentFromCommerce(
      {},
      "invoice",
      { entity_id: 9, increment_id: "5000000023", order_id: ORDER_ID },
      {
        erp: { fromCommerce: { invoice, ship: vi.fn() } },
        erps: ERPS,
        getInvoice: async () => ({ entity_id: 9, items: [] }),
        getOrder: async () => ({ increment_id: ORDER }),
      },
    );
    expect(invoice).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      erpIds: [],
      message:
        "Commerce invoice 5000000023 names no lines of any ERP's part; no ERP was told.",
      outcome: "skipped",
      statusCode: 200,
    });
  });

  test("Then with one ERP, or an order that was never split, it is not handled here", async () => {
    const deps = {
      erp: {},
      erps: [ERPS[0]],
      getOrder: async () => ({ increment_id: ORDER }),
    };
    expect(
      await fulfilmentFromCommerce(
        {},
        "shipment",
        { order_id: ORDER_ID },
        deps,
      ),
    ).toBeNull();
    expect(
      await fulfilmentFromCommerce(
        {},
        "shipment",
        { order_id: 1 },
        {
          ...deps,
          erps: ERPS,
          getOrder: async () => ({ increment_id: "never-split" }),
        },
      ),
    ).toBeNull();
  });
});

describe("Given one ERP's part is held while another ERP ships and invoices", () => {
  test("Then the other ERP's partial invoice and shipment go through and the order is never put On Hold", async () => {
    const record = await readOrderParts(ORDER);
    record.parts["brand-a"] = { ...record.parts["brand-a"], status: "held" };
    await writeOrderParts(ORDER, record);
    const invoiceItems = vi.fn(async () => 902);
    const order = { state: "processing", status: "processing" };
    const commerce = {
      addComment: vi.fn(async () => ({})),
      getOrder: vi.fn(async () => ({ ...order })),
      holdOrder: vi.fn(async () => true),
      unholdOrder: vi.fn(async () => true),
    };
    const msg = message("brand-b", "B-200", [
      { orderItemId: 2, qty: 5, sku: "SIGN1" },
    ]);

    const shipment = await prepareShipment(
      {},
      ORDER_ID,
      msg,
      { items: [{ order_item_id: 2, qty: 5 }] },
      { erps: ERPS, invoiceItems },
    );
    await recordShipped(ORDER, "brand-b", [{ order_item_id: 2, qty: 5 }]);
    const decision = await applyCombinedStatus(
      {},
      ORDER_ID,
      await readOrderParts(ORDER),
      commerce,
    );

    expect(invoiceItems).toHaveBeenCalledExactlyOnceWith({}, ORDER_ID, [
      { order_item_id: 2, qty: 5 },
    ]);
    expect(shipment).toMatchObject({
      erpId: "brand-b",
      items: [{ order_item_id: 2, qty: 5 }],
      matched: true,
    });
    expect(decision).toMatchObject({
      action: "mark-partially-held",
      status: "partially-held",
    });
    expect(commerce.holdOrder).not.toHaveBeenCalled();
  });
});
