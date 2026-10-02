/*
 * A Commerce return reaches each ERP that sold its lines (returns-design.md §3.1 steps 3 to 5,
 * slice E): split by the order's parts record, one return order per ERP referencing that ERP's
 * own sales order, recorded in order-returns-<return id>; a line no ERP sold is recorded and
 * never sent; a later save of the same return sends nothing new. Each ERP that accepts has its
 * items authorized in Commerce.
 */
import {
  lockOrder,
  resetOrderPartsClient,
  writeOrderParts,
} from "#lib/order-parts";
import { readOrderReturn, resetOrderReturnsClient } from "#lib/order-returns";
import { returnToErps } from "#router/return-pieces";

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

const A_URL = "https://a.example/api/v1/web/erp";
const B_URL = "https://b.example/api/v1/web/erp";
const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: A_URL },
    id: "justrite",
    name: "Justrite ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: B_URL },
    id: "accuform",
    name: "Accuform ERP",
  },
];
const ORDER = "5000000002";
const ORDER_ID = 31;

/** Line 38 a configurable sign (child 39), Accuform's; line 40 a cabinet, Justrite's; 41 nobody's. */
const ORDER_DOC = {
  entity_id: ORDER_ID,
  ext_order_id: null,
  increment_id: ORDER,
  items: [
    { item_id: 38, product_type: "configurable", sku: "SIGN" },
    { item_id: 39, parent_item_id: 38, sku: "SIGN-RED" },
    { item_id: 40, sku: "CAB1" },
    { item_id: 41, sku: "GIFT" },
  ],
};

const item = (entityId, orderItemId, qty) => ({
  condition: "9",
  entity_id: entityId,
  order_item_id: orderItemId,
  qty_approved: null,
  qty_authorized: null,
  qty_requested: qty,
  qty_returned: null,
  reason: "8",
  resolution: "5",
  rma_entity_id: 4,
  status: "pending",
});

/** The return as GET returns/4 answers: the sign by its child line, and the cabinet. */
const RETURN = {
  entity_id: 4,
  increment_id: "000000004",
  items: [item(11, 39, 2), item(12, 40, 1)],
  order_id: ORDER_ID,
  order_increment_id: ORDER,
  status: "pending",
};

async function routed() {
  await writeOrderParts(ORDER, {
    conflicts: [],
    parts: {
      accuform: { erpNumber: "B-200", itemIds: [38, 39], status: "sent" },
      justrite: { erpNumber: "A-100", itemIds: [40], status: "sent" },
    },
    unrouted: [],
  });
}

const accepted = (number) => ({
  data: { number, status: "open" },
  ok: true,
  status: 201,
});

function collaborators(over = {}) {
  let rma = structuredClone(RETURN);
  const numbers = { [A_URL]: "RA-1", [B_URL]: "RB-1" };
  return {
    addReturnComment: vi.fn(async () => ({})),
    erp: {
      fromCommerce: {
        sendReturn: vi.fn(async (p) => accepted(numbers[p.ERP_BASE_URL])),
      },
      order: vi.fn(async (_p, number) => ({ data: { number }, ok: true })),
    },
    erps: ERPS,
    getOrder: vi.fn(async () => structuredClone(ORDER_DOC)),
    // The return as Commerce holds it now: a write is read back by the next read.
    getReturn: vi.fn(async () => structuredClone(rma)),
    // Commerce's reason labels by option value (GET returnsAttributeMetadata).
    reasonLabels: vi.fn(async () => new Map([["8", "Wrong Size"]])),
    settingsFor: async () => ({}),
    // Commerce keeps the items a write leaves out (Justrite, 2026-10-02): merge by entity_id.
    updateReturn: vi.fn((_p, _id, next) => {
      const sent = new Map(next.items.map((i) => [i.entity_id, i]));
      rma = structuredClone({
        ...next,
        items: rma.items.map((i) => sent.get(i.entity_id) ?? i),
      });
      return Promise.resolve({});
    }),
    wait: async () => undefined,
    ...over,
  };
}

const sentTo = (deps) =>
  deps.erp.fromCommerce.sendReturn.mock.calls.map(([p, body]) => [
    p.ERP_BASE_URL,
    body,
  ]);

let state;
beforeEach(async () => {
  state = memoryState();
  resetOrderPartsClient(state);
  resetOrderReturnsClient(state);
  await routed();
});

describe("Given a return over two ERPs' lines", () => {
  test.each(["closed", "processed_closed", "denied"])(
    "Then a %s return is sent to no ERP: a finished return asks nothing of them",
    async (status) => {
      const deps = collaborators();
      deps.getReturn.mockResolvedValueOnce({
        ...structuredClone(RETURN),
        status,
      });

      const res = await returnToErps({ id: "ev-9" }, 4, deps);

      expect(res).toMatchObject({ outcome: "skipped", statusCode: 200 });
      expect(deps.erp.fromCommerce.sendReturn).not.toHaveBeenCalled();
    },
  );

  test("Then a reason Commerce cannot name is sent as its stored value", async () => {
    const deps = collaborators({
      reasonLabels: vi.fn(() =>
        Promise.reject(new Error("metadata unreadable")),
      ),
    });

    await returnToErps({ id: "ev-9" }, 4, deps);

    expect(sentTo(deps)[0][1].lines[0].reason).toBe("8");
  });

  test("Then each ERP is sent a return order of only its lines, on its own sales order, by the order line it sold", async () => {
    const deps = collaborators();

    const res = await returnToErps({ id: "ev-9" }, 4, deps);

    expect(res).toMatchObject({ outcome: "sent", statusCode: 200 });
    expect(sentTo(deps)).toEqual([
      [
        A_URL,
        {
          customerReturnReference: "4",
          lines: [
            { customerLineReference: "40", qty: 1, reason: "Wrong Size" },
          ],
          orderNumber: "A-100",
          origin: {
            document: "return 000000004",
            eventId: "ev-9",
            system: "Adobe Commerce",
          },
        },
      ],
      [
        B_URL,
        {
          customerReturnReference: "4",
          // Returned by its child line 39; the ERP's sales order names the parent, 38.
          lines: [
            { customerLineReference: "38", qty: 2, reason: "Wrong Size" },
          ],
          orderNumber: "B-200",
          origin: {
            document: "return 000000004",
            eventId: "ev-9",
            system: "Adobe Commerce",
          },
        },
      ],
    ]);
  });

  test("Then each piece is recorded with the ERP's return order number, and a return comment names each", async () => {
    const deps = collaborators();

    await returnToErps({}, 4, deps);

    const record = await readOrderReturn(4);
    expect(record).toMatchObject({
      orderId: ORDER_ID,
      orderIncrementId: ORDER,
      pieces: {
        accuform: {
          items: [
            { commerceItemId: 38, orderItemId: 39, qty: 2, returnItemId: 11 },
          ],
          orderNumber: "B-200",
          returnNumber: "RB-1",
          status: "sent",
        },
        justrite: {
          items: [
            { commerceItemId: 40, orderItemId: 40, qty: 1, returnItemId: 12 },
          ],
          orderNumber: "A-100",
          returnNumber: "RA-1",
          status: "sent",
        },
      },
      unrouted: [],
    });
    expect(deps.addReturnComment.mock.calls).toEqual([
      [{}, 4, "Sent to Justrite ERP as return order RA-1"],
      [{}, 4, "Sent to Accuform ERP as return order RB-1"],
    ]);
  });

  test("Then every item is authorized for the quantity sent, and the return is authorized, written back whole", async () => {
    const deps = collaborators();

    await returnToErps({}, 4, deps);

    expect(deps.updateReturn).toHaveBeenCalledTimes(1);
    const [[, id, rma]] = deps.updateReturn.mock.calls;
    expect(id).toBe(4);
    expect(rma.increment_id).toBe("000000004");
    expect(rma.status).toBe("authorized");
    expect(
      rma.items.map((i) => [i.entity_id, i.status, i.qty_authorized]),
    ).toEqual([
      [11, "authorized", 2],
      [12, "authorized", 1],
    ]);
  });

  test("Then a later save of the same return sends nothing and writes nothing", async () => {
    const deps = collaborators();
    await returnToErps({}, 4, deps);

    const again = await returnToErps({}, 4, deps);

    expect(again).toMatchObject({ outcome: "skipped", statusCode: 200 });
    expect(deps.erp.fromCommerce.sendReturn).toHaveBeenCalledTimes(2);
    expect(deps.addReturnComment).toHaveBeenCalledTimes(2);
    expect(deps.updateReturn).toHaveBeenCalledTimes(1);
  });

  test("Then a line no ERP sold is recorded as unrouted and never sent", async () => {
    const deps = collaborators({
      getReturn: vi.fn(async () => ({
        ...structuredClone(RETURN),
        items: [item(12, 40, 1), item(13, 41, 1)],
      })),
    });

    const res = await returnToErps({}, 4, deps);

    expect(sentTo(deps).map(([url]) => url)).toEqual([A_URL]);
    expect((await readOrderReturn(4)).unrouted).toEqual([13]);
    expect(res.message).toContain("line 41");
    // Only the routed line counts: the return is authorized.
    expect(deps.updateReturn.mock.calls[0][2].status).toBe("authorized");
  });
});

describe("Given a return whose every line no ERP sold", () => {
  test("Then it is refused once with a comment, and a later save of it is nothing to do", async () => {
    const deps = collaborators({
      getReturn: vi.fn(async () => ({
        ...structuredClone(RETURN),
        items: [item(13, 41, 1)],
      })),
    });

    const first = await returnToErps({}, 4, deps);
    const again = await returnToErps({}, 4, deps);

    expect(first).toMatchObject({ outcome: "dropped", statusCode: 400 });
    expect(again).toMatchObject({ outcome: "skipped", statusCode: 200 });
    expect(deps.addReturnComment.mock.calls).toEqual([
      [{}, 4, "Not sent to any ERP: order line 41 was sold through none"],
    ]);
    expect(deps.erp.fromCommerce.sendReturn).not.toHaveBeenCalled();
    expect(deps.updateReturn).not.toHaveBeenCalled();
  });
});

describe("Given one ERP is down and the other accepts", () => {
  test("Then the other's piece is sent, the down one waits failed, the return is partly authorized, and redelivery sends only the waiting piece", async () => {
    const deps = collaborators();
    deps.erp.fromCommerce.sendReturn.mockImplementation(async (p) =>
      p.ERP_BASE_URL === B_URL
        ? Promise.reject(new TypeError("fetch failed"))
        : accepted("RA-1"),
    );

    const res = await returnToErps({}, 4, deps);

    expect(res).toMatchObject({ outcome: "held", statusCode: 503 });
    const record = await readOrderReturn(4);
    expect(record.pieces.justrite.status).toBe("sent");
    expect(record.pieces.accuform).toMatchObject({ status: "failed" });
    expect(record.pieces.accuform.refused).toBeUndefined();
    expect(deps.updateReturn.mock.calls[0][2].status).toBe(
      "partially_authorized",
    );

    deps.erp.fromCommerce.sendReturn.mockImplementation(async () =>
      accepted("RB-1"),
    );
    const again = await returnToErps({}, 4, deps);

    expect(again).toMatchObject({ outcome: "sent", statusCode: 200 });
    expect(sentTo(deps).map(([url]) => url)).toEqual([A_URL, B_URL, B_URL]);
    expect((await readOrderReturn(4)).pieces.accuform.status).toBe("sent");
  });

  test("Then an ERP that refuses its piece is recorded refused with its reason, commented, and not sent again by a redelivery", async () => {
    const deps = collaborators();
    deps.erp.fromCommerce.sendReturn.mockImplementation(async (p) =>
      p.ERP_BASE_URL === B_URL
        ? {
            data: { errorMessage: "line 38: more than invoiced" },
            ok: false,
            status: 400,
          }
        : accepted("RA-1"),
    );

    const res = await returnToErps({}, 4, deps);

    expect(res).toMatchObject({ outcome: "sent", statusCode: 200 });
    expect((await readOrderReturn(4)).pieces.accuform).toMatchObject({
      refused: true,
      status: "failed",
    });
    expect(deps.addReturnComment).toHaveBeenCalledWith(
      {},
      4,
      "Accuform ERP refused its return order: line 38: more than invoiced",
    );

    await returnToErps({}, 4, deps);
    expect(deps.erp.fromCommerce.sendReturn).toHaveBeenCalledTimes(2);
  });
});

describe("Given the order is held by another write", () => {
  test("Then nothing is sent and the event is delivered again", async () => {
    const deps = collaborators({ attempts: 1 });
    await lockOrder(ORDER);

    const res = await returnToErps({}, 4, deps);

    expect(res).toMatchObject({ outcome: "held", statusCode: 503 });
    expect(deps.erp.fromCommerce.sendReturn).not.toHaveBeenCalled();
  });
});

describe("Given one ERP", () => {
  test("Then the whole return goes to it, on the sales order the Commerce order carries", async () => {
    const deps = collaborators({
      erps: [ERPS[0]],
      getOrder: vi.fn(async () => ({
        ...structuredClone(ORDER_DOC),
        ext_order_id: "0000001000",
      })),
    });
    state.store.clear();
    // The deployed ERP's own settings: the order's number prefix is read from its name.
    const params = { ERP_BASE_URL: A_URL };

    const res = await returnToErps(params, 4, deps);

    expect(res).toMatchObject({ outcome: "sent" });
    // Rule M2, as the single-ERP paths do (lib/commerce-changes.js), with the action's own
    // params: the ERP is asked for that sales order first.
    expect(deps.erp.order).toHaveBeenCalledExactlyOnceWith(
      params,
      "0000001000",
    );
    expect(deps.erp.fromCommerce.sendReturn.mock.calls[0][0]).toBe(params);
    expect(sentTo(deps)).toEqual([
      [
        A_URL,
        expect.objectContaining({
          lines: [
            { customerLineReference: "38", qty: 2, reason: "Wrong Size" },
            { customerLineReference: "40", qty: 1, reason: "Wrong Size" },
          ],
          orderNumber: "0000001000",
        }),
      ],
    ]);
  });

  test("Then an order that never reached the ERP sends nothing, and says so", async () => {
    const deps = collaborators({ erps: [ERPS[0]] });
    state.store.clear();

    const res = await returnToErps({}, 4, deps);

    expect(deps.erp.fromCommerce.sendReturn).not.toHaveBeenCalled();
    expect(res.outcome).toBe("dropped");
    expect((await readOrderReturn(4)).pieces.justrite).toMatchObject({
      refused: true,
      status: "failed",
    });
  });
});
