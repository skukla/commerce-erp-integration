/*
 * An ERP's credit memo becomes a Commerce credit memo of only that ERP's lines (returns-design.md
 * §3.1 step 7, slice D): offline, under the order's lock, keyed by the ERP's credit memo number
 * so a redelivered event credits nothing twice; a comment on the order, and on the return when
 * the credit memo names one, whose credited items are approved.
 */
import {
  lockOrder,
  resetOrderPartsClient,
  writeOrderParts,
} from "#lib/order-parts";
import {
  readOrderCredits,
  readOrderReturn,
  resetOrderReturnsClient,
  writeOrderReturn,
} from "#lib/order-returns";
import { creditMemoFromErp } from "#router/credit-memos";

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
    id: "justrite",
    name: "Justrite ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "accuform",
    name: "Accuform ERP",
  },
];
const ORDER = "5000000002";
const ORDER_ID = 31;

/** Line 38 is a configurable sign (its child line 39), Accuform's; line 40 a cabinet, Justrite's. */
const ORDER_DOC = {
  entity_id: ORDER_ID,
  increment_id: ORDER,
  items: [
    { item_id: 38, product_type: "configurable", qty_ordered: 2, sku: "SIGN" },
    { item_id: 39, parent_item_id: 38, qty_ordered: 2, sku: "SIGN-RED" },
    { item_id: 40, qty_ordered: 1, sku: "CAB1" },
  ],
};

async function routed() {
  await writeOrderParts(ORDER, {
    conflicts: [],
    parts: {
      accuform: {
        erpNumber: "B-200",
        itemIds: [38, 39],
        skus: ["SIGN"],
        status: "sent",
      },
      justrite: {
        erpNumber: "A-100",
        itemIds: [40],
        skus: ["CAB1"],
        status: "sent",
      },
    },
    unrouted: [],
  });
}

/** The ERP's event value (contract v13, be-observer.sales_order_creditmemo_create). */
const creditMemo = (over = {}) => ({
  commerceReturnId: null,
  creditMemoNumber: "9500000001",
  erpId: "accuform",
  erpNumber: "B-200",
  id: ORDER_ID,
  incrementId: ORDER,
  items: [{ orderItemId: 38, qty: 2, sku: "SIGN" }],
  notifyCustomer: false,
  orderId: ORDER_ID,
  returnNumber: null,
  total: 42.42,
  ...over,
});

function collaborators(over = {}) {
  return {
    addComment: vi.fn(async () => ({})),
    addReturnComment: vi.fn(async () => ({})),
    erps: ERPS,
    getOrder: vi.fn(async () => structuredClone(ORDER_DOC)),
    getReturn: vi.fn(),
    refundOrderItems: vi.fn(async () => "1"),
    updateReturn: vi.fn(async () => ({})),
    wait: async () => undefined,
    ...over,
  };
}

let state;
beforeEach(async () => {
  state = memoryState();
  resetOrderPartsClient(state);
  resetOrderReturnsClient(state);
  await routed();
});

describe("Given one of two ERPs credits its line", () => {
  test("Then Commerce credits only that line, offline, and the order's history names the ERP and its credit memo", async () => {
    const deps = collaborators();

    const res = await creditMemoFromErp({}, ORDER_ID, creditMemo(), deps);

    expect(res).toMatchObject({ matched: true });
    expect(deps.refundOrderItems).toHaveBeenCalledExactlyOnceWith(
      {},
      ORDER_ID,
      [{ order_item_id: 38, qty: 2 }],
      "Credited in Accuform ERP (credit memo 9500000001)",
    );
    expect(deps.addComment).toHaveBeenCalledExactlyOnceWith({}, ORDER_ID, {
      statusHistory: {
        comment: "Credited in Accuform ERP (credit memo 9500000001)",
        is_customer_notified: 0,
        is_visible_on_front: 0,
      },
    });
    expect(
      (await readOrderCredits(ORDER)).applied["accuform/9500000001"],
    ).toMatchObject({
      commerceCreditMemoId: "1",
      items: [{ order_item_id: 38, qty: 2 }],
    });
  });

  test("Then a line named by its configurable child is credited on its parent, which Commerce applies to both", async () => {
    const deps = collaborators();

    await creditMemoFromErp(
      {},
      ORDER_ID,
      creditMemo({ items: [{ orderItemId: 39, qty: 2, sku: "SIGN-RED" }] }),
      deps,
    );

    expect(deps.refundOrderItems.mock.calls[0][2]).toEqual([
      { order_item_id: 38, qty: 2 },
    ]);
  });

  test("Then the same credit memo delivered again credits nothing and comments nothing", async () => {
    const deps = collaborators();
    await creditMemoFromErp({}, ORDER_ID, creditMemo(), deps);

    const again = await creditMemoFromErp({}, ORDER_ID, creditMemo(), deps);

    expect(again).toMatchObject({ already: true, matched: true });
    expect(deps.refundOrderItems).toHaveBeenCalledTimes(1);
    expect(deps.addComment).toHaveBeenCalledTimes(1);
  });

  test("Then a credit memo naming the other ERP's line is refused, and nothing is credited", async () => {
    const deps = collaborators();

    const res = await creditMemoFromErp(
      {},
      ORDER_ID,
      creditMemo({
        items: [
          { orderItemId: 38, qty: 2, sku: "SIGN" },
          { orderItemId: 40, qty: 1, sku: "CAB1" },
        ],
      }),
      deps,
    );

    expect(res).toEqual({
      matched: false,
      reason: `order ${ORDER}: line 40 is not Accuform ERP's; credit memo 9500000001 not applied`,
    });
    expect(deps.refundOrderItems).not.toHaveBeenCalled();
  });

  test("Then a credit memo for a line the order does not have is refused", async () => {
    const deps = collaborators();

    const res = await creditMemoFromErp(
      {},
      ORDER_ID,
      creditMemo({ items: [{ orderItemId: 77, qty: 1, sku: "X" }] }),
      deps,
    );

    expect(res).toMatchObject({ matched: false });
    expect(res.reason).toContain("line 77");
    expect(deps.refundOrderItems).not.toHaveBeenCalled();
  });

  test("Then a credit memo from an ERP with no part of the order is refused", async () => {
    const deps = collaborators();

    const res = await creditMemoFromErp(
      {},
      ORDER_ID,
      creditMemo({ erpId: "other", erpNumber: "Z-1" }),
      deps,
    );

    expect(res).toMatchObject({ matched: false });
    expect(deps.refundOrderItems).not.toHaveBeenCalled();
  });

  test("Then while another write holds the order, the event is answered busy and nothing is credited", async () => {
    const deps = collaborators({ attempts: 1 });
    await lockOrder(ORDER);

    const res = await creditMemoFromErp({}, ORDER_ID, creditMemo(), deps);

    expect(res).toMatchObject({ busy: true });
    expect(deps.refundOrderItems).not.toHaveBeenCalled();
  });

  test("Then a credit memo with no number is refused: it could not be told from a redelivery", async () => {
    const deps = collaborators();

    const res = await creditMemoFromErp(
      {},
      ORDER_ID,
      creditMemo({ creditMemoNumber: null }),
      deps,
    );

    expect(res).toMatchObject({ matched: false });
    expect(deps.refundOrderItems).not.toHaveBeenCalled();
  });
});

describe("Given one ERP, and no parts record", () => {
  test("Then the whole credit memo is credited, named by that ERP", async () => {
    const deps = collaborators({ erps: [ERPS[0]] });
    state.store.clear();

    const res = await creditMemoFromErp(
      {},
      ORDER_ID,
      creditMemo({
        erpId: undefined,
        erpNumber: "A-100",
        items: [
          { orderItemId: 38, qty: 1, sku: "SIGN" },
          { orderItemId: 40, qty: 1, sku: "CAB1" },
        ],
      }),
      deps,
    );

    expect(res).toMatchObject({ matched: true });
    expect(deps.refundOrderItems).toHaveBeenCalledExactlyOnceWith(
      {},
      ORDER_ID,
      [
        { order_item_id: 38, qty: 1 },
        { order_item_id: 40, qty: 1 },
      ],
      "Credited in Justrite ERP (credit memo 9500000001)",
    );
    expect(
      (await readOrderCredits(ORDER)).applied["justrite/9500000001"],
    ).toBeDefined();
  });
});

describe("Given the credit memo names a return", () => {
  const RETURN = {
    entity_id: 4,
    increment_id: "000000004",
    items: [
      {
        entity_id: 11,
        order_item_id: 38,
        qty_authorized: 2,
        qty_requested: 2,
        qty_returned: 2,
        status: "received",
      },
      {
        entity_id: 12,
        order_item_id: 40,
        qty_authorized: 1,
        qty_requested: 1,
        qty_returned: 1,
        status: "received",
      },
    ],
    order_id: ORDER_ID,
    status: "received",
  };

  beforeEach(async () => {
    await writeOrderReturn(4, {
      orderId: ORDER_ID,
      orderIncrementId: ORDER,
      pieces: {
        accuform: {
          items: [{ commerceItemId: 38, qty: 2, returnItemId: 11 }],
          returnNumber: "8000000001",
          status: "received",
        },
        justrite: {
          items: [{ commerceItemId: 40, qty: 1, returnItemId: 12 }],
          returnNumber: "8000000002",
          status: "received",
        },
      },
      unrouted: [],
    });
  });

  test("Then the return gets a comment, its piece reads credited, and that ERP's item is approved for the credited quantity", async () => {
    const deps = collaborators({
      getReturn: vi.fn(async () => structuredClone(RETURN)),
    });

    await creditMemoFromErp(
      {},
      ORDER_ID,
      creditMemo({ commerceReturnId: 4, returnNumber: "8000000001" }),
      deps,
    );

    expect(deps.addReturnComment).toHaveBeenCalledExactlyOnceWith(
      {},
      4,
      "Credited by Accuform ERP (credit memo 9500000001)",
    );
    expect((await readOrderReturn(4)).pieces.accuform).toMatchObject({
      creditMemos: ["9500000001"],
      status: "credited",
    });
    const [[, id, rma]] = deps.updateReturn.mock.calls;
    expect(id).toBe(4);
    expect(rma.increment_id).toBe("000000004");
    expect(rma.items[0]).toMatchObject({ qty_approved: 2, status: "approved" });
    expect(rma.items[1].status).toBe("received");
    // Justrite has not credited yet: the return stays received.
    expect(rma.status).toBe("received");
  });

  test("Then the last ERP's credit closes the return", async () => {
    const half = structuredClone(RETURN);
    half.items[0] = { ...half.items[0], qty_approved: 2, status: "approved" };
    const deps = collaborators({ getReturn: vi.fn(async () => half) });

    await creditMemoFromErp(
      {},
      ORDER_ID,
      creditMemo({
        commerceReturnId: 4,
        creditMemoNumber: "9500000009",
        erpId: "justrite",
        erpNumber: "A-100",
        items: [{ orderItemId: 40, qty: 1, sku: "CAB1" }],
        returnNumber: "8000000002",
      }),
      deps,
    );

    expect(deps.updateReturn.mock.calls[0][2].status).toBe("processed_closed");
  });
});
