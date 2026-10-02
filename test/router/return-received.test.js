/*
 * An ERP's goods are back (contract v13 be-observer.rma_status_update; returns-design.md §3.1
 * step 6, slice F): a return comment naming the ERP and its return order, the piece recorded
 * received, and that ERP's items received in Commerce for the quantities it received.
 */
import {
  lockOrder,
  resetOrderPartsClient,
  writeOrderParts,
} from "#lib/order-parts";
import {
  readOrderReturn,
  resetOrderReturnsClient,
  writeOrderReturn,
} from "#lib/order-returns";
import { returnReceivedFromErp } from "#router/return-received";

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
  { adapter: "demo-erp", connection: {}, id: "justrite", name: "Justrite ERP" },
  { adapter: "demo-erp", connection: {}, id: "accuform", name: "Accuform ERP" },
];
const ORDER = "5000000002";
const ORDER_ID = 31;
const ORDER_DOC = {
  entity_id: ORDER_ID,
  increment_id: ORDER,
  items: [
    { item_id: 38, sku: "SIGN" },
    { item_id: 39, parent_item_id: 38, sku: "SIGN-RED" },
    { item_id: 40, sku: "CAB1" },
  ],
};

const authorized = (entityId, orderItemId, qty) => ({
  entity_id: entityId,
  order_item_id: orderItemId,
  qty_authorized: qty,
  qty_requested: qty,
  status: "authorized",
});
const RETURN = {
  entity_id: 4,
  increment_id: "000000004",
  items: [authorized(11, 39, 2), authorized(12, 40, 1)],
  order_id: ORDER_ID,
  status: "authorized",
};

/** The ERP's event value: Accuform's return order RB-1 received, its line 38 (qty 2). */
const received = (over = {}) => ({
  commerceReturnId: 4,
  erpNumber: "B-200",
  id: ORDER_ID,
  incrementId: ORDER,
  items: [{ orderItemId: 38, qty: 2, sku: "SIGN" }],
  orderId: ORDER_ID,
  returnNumber: "RB-1",
  status: "received",
  ...over,
});

function collaborators(over = {}) {
  return {
    addReturnComment: vi.fn(async () => ({})),
    erps: ERPS,
    getOrder: vi.fn(async () => structuredClone(ORDER_DOC)),
    getReturn: vi.fn(async () => structuredClone(RETURN)),
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
  await writeOrderParts(ORDER, {
    parts: {
      accuform: { erpNumber: "B-200", itemIds: [38, 39], status: "sent" },
      justrite: { erpNumber: "A-100", itemIds: [40], status: "sent" },
    },
  });
  await writeOrderReturn(4, {
    orderId: ORDER_ID,
    orderIncrementId: ORDER,
    pieces: {
      accuform: {
        items: [
          { commerceItemId: 38, orderItemId: 39, qty: 2, returnItemId: 11 },
        ],
        returnNumber: "RB-1",
        status: "sent",
      },
      justrite: {
        items: [
          { commerceItemId: 40, orderItemId: 40, qty: 1, returnItemId: 12 },
        ],
        returnNumber: "RA-1",
        status: "sent",
      },
    },
    unrouted: [],
  });
});

describe("Given one of two ERPs received its goods", () => {
  test("Then the return gets a comment naming the ERP and its return order, and its piece reads received", async () => {
    const deps = collaborators();

    const res = await returnReceivedFromErp({}, received(), deps);

    expect(res).toMatchObject({ matched: true });
    expect(deps.addReturnComment).toHaveBeenCalledExactlyOnceWith(
      {},
      4,
      "Goods received by Accuform ERP (return order RB-1)",
    );
    expect((await readOrderReturn(4)).pieces.accuform.status).toBe("received");
    expect((await readOrderReturn(4)).pieces.justrite.status).toBe("sent");
  });

  test("Then its item (returned by the child line) is received for that quantity, and the return is partly received", async () => {
    const deps = collaborators();

    await returnReceivedFromErp({}, received(), deps);

    const [[, id, rma]] = deps.updateReturn.mock.calls;
    expect(id).toBe(4);
    expect(rma.increment_id).toBe("000000004");
    expect(rma.items[0]).toMatchObject({ qty_returned: 2, status: "received" });
    expect(rma.items[1].status).toBe("authorized");
    expect(rma.status).toBe("received_on_item");
  });

  test("Then the same event delivered again comments nothing more", async () => {
    const deps = collaborators();
    await returnReceivedFromErp({}, received(), deps);

    await returnReceivedFromErp({}, received(), deps);

    expect(deps.addReturnComment).toHaveBeenCalledTimes(1);
  });

  test("Then the ERP is found by the event's ERP id when it names one", async () => {
    const deps = collaborators();

    await returnReceivedFromErp(
      {},
      received({
        erpId: "justrite",
        erpNumber: "A-100",
        items: [{ orderItemId: 40, qty: 1, sku: "CAB1" }],
        returnNumber: "RA-1",
      }),
      deps,
    );

    expect(deps.addReturnComment.mock.calls[0][2]).toBe(
      "Goods received by Justrite ERP (return order RA-1)",
    );
  });
});

describe("Given an event that cannot be applied", () => {
  test("Then one naming no return is refused", async () => {
    const res = await returnReceivedFromErp(
      {},
      received({ commerceReturnId: null }),
      collaborators(),
    );

    expect(res).toMatchObject({ matched: false });
  });

  test("Then one from an ERP with no piece of the return and no part of the order is refused", async () => {
    const deps = collaborators();

    const res = await returnReceivedFromErp(
      {},
      received({ erpId: "other", erpNumber: "Z-9", returnNumber: "Z-1" }),
      deps,
    );

    expect(res).toMatchObject({ matched: false });
    expect(deps.addReturnComment).not.toHaveBeenCalled();
  });

  test("Then while another write holds the order it is answered busy", async () => {
    const deps = collaborators({ attempts: 1 });
    await lockOrder(ORDER);

    const res = await returnReceivedFromErp({}, received(), deps);

    expect(res).toMatchObject({ busy: true });
    expect(deps.addReturnComment).not.toHaveBeenCalled();
  });
});
