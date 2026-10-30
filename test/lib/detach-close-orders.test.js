/*
 * erp/detach with closeOrders (AB-16n; the one reset rule, owner 2026-10-30): before the ERPs are
 * wiped, every order they hold is closed off in Commerce by the rule lib/reset-rule.js states. An
 * order with nothing invoiced and nothing shipped is canceled; any other not already canceled or
 * closed has what is invoiced refunded offline, so it closes; its open returns are closed; one
 * Commerce can neither cancel nor credit is only noted. Its parts record goes, its ERP number goes,
 * and its hold comes off. Every order is marked closed BEFORE the first Commerce write, so the
 * events those writes raise send nothing to an ERP.
 */
// biome-ignore-all lint/suspicious/useAwait: the fakes answer promises without waiting on anything; the real collaborators are async and detach awaits them
import { detach } from "#lib/detach";

const DAY = "2026-09-28";
const CANCELLED = `Canceled by the demo reset on ${DAY}.`;
const REFUNDED = `Refunded and closed by the demo reset on ${DAY}.`;
const REMOVED = `The ERP documents for this order were removed by the demo reset on ${DAY}.`;

/** The close's counts with nothing done, for `toEqual` over a whole answer. */
const NOTHING = {
  alreadyClosed: 0,
  cancelled: 0,
  commented: 0,
  failed: [],
  partsRemoved: 0,
  refunded: 0,
  returnsClosed: 0,
};

const line = (extra = {}) => ({
  item_id: 1,
  qty_canceled: 0,
  qty_invoiced: 0,
  qty_ordered: 2,
  qty_shipped: 0,
  sku: "A1",
  ...extra,
});

/** A Commerce order as `GET orders/{id}` answers it (the fields the close reads). */
const order = (id, extra = {}) => ({
  entity_id: id,
  ext_order_id: "",
  increment_id: `00000${id}`,
  items: [line()],
  state: "new",
  status_histories: [],
  ...extra,
});

/** The Commerce calls the close makes, over a map of orders; `calls` lists them in order. */
function fakeCommerce(orders) {
  const calls = [];
  const byId = new Map(orders.map((o) => [String(o.entity_id), o]));
  return {
    calls,
    clearExtOrderId: vi.fn(async (_p, id) => {
      calls.push(["clearExtOrderId", String(id)]);
      byId.get(String(id)).ext_order_id = "";
    }),
    findOrderByIncrementId: vi.fn(async (_p, inc) => {
      const found = orders.find((o) => o.increment_id === inc);
      return found ? { entityId: found.entity_id } : null;
    }),
    orders: {
      cancel: vi.fn(async (_p, id) => {
        calls.push(["cancel", String(id)]);
        return true;
      }),
      comment: vi.fn(async (_p, id, comment) => {
        calls.push(["comment", String(id), comment]);
      }),
      get: vi.fn(async (_p, id) =>
        structuredClone(byId.get(String(id)) ?? null),
      ),
    },
    unholdIfHeld: vi.fn(async (_p, id) => {
      calls.push(["unholdIfHeld", String(id)]);
      const o = byId.get(String(id));
      if (o.state !== "holded") {
        return false;
      }
      o.state = "new";
      return true;
    }),
  };
}

/**
 * The refund and return calls (#src/order/commerce-order-api-client), over a map of returns by
 * id; `keepOpen` names returns Commerce saves without closing.
 */
function fakeOrderClient(calls, returns = [], { keepOpen = [] } = {}) {
  const byId = new Map(returns.map((r) => [Number(r.entity_id), r]));
  return {
    getReturn: vi.fn(async (_p, id) => structuredClone(byId.get(Number(id)))),
    listOrderReturns: vi.fn(async (_p, orderId) => {
      calls.push(["listOrderReturns", String(orderId)]);
      return structuredClone(
        [...byId.values()].filter((r) => r.order_id === Number(orderId)),
      );
    }),
    refundOrder: vi.fn(async (_p, id, body) => {
      calls.push(["refundOrder", String(id), body]);
      return "901";
    }),
    returns: byId,
    updateReturn: vi.fn(async (_p, id, rma) => {
      calls.push(["updateReturn", Number(id), rma.status]);
      if (!keepOpen.includes(Number(id))) {
        byId.get(Number(id)).status = rma.status;
      }
      return {};
    }),
  };
}

/** The integration's per-order records: parts records and closed marks, as order-parts.js keeps them. */
function fakeOrderParts(ids, calls) {
  const parts = new Set(ids);
  const marked = new Map();
  return {
    deleteOrderParts: vi.fn(async (inc) => {
      calls.push(["deleteOrderParts", inc]);
      return parts.delete(inc);
    }),
    listOrderPartsIds: vi.fn(async () => [...parts]),
    markClosedByReset: vi.fn(async (inc, day) => {
      calls.push(["markClosedByReset", inc]);
      marked.set(inc, day);
    }),
    marked,
    parts,
  };
}

const listing = (items) => ({
  listOrders: vi.fn(async () => ({ data: { items }, ok: true, status: 200 })),
});
const ledger = {
  revertLedger: vi.fn(async () => ({ failed: [], reverted: 0 })),
};

function setUp(orders, { listed = [], parts = [], returns, keepOpen } = {}) {
  const commerce = fakeCommerce(orders);
  const orderParts = fakeOrderParts(parts, commerce.calls);
  const orderClient = fakeOrderClient(commerce.calls, returns, { keepOpen });
  const deps = {
    commerce,
    erp: listing(listed),
    ledger,
    orderClient,
    orderParts,
    today: () => DAY,
  };
  return { commerce, deps, orderClient, orderParts };
}

/** An open return on an order, as GET returns/{id} answers it (the fields the close reads). */
const aReturn = (id, orderId, extra = {}) => ({
  comments: [{ comment: "asked" }],
  entity_id: id,
  increment_id: `00000000${id}`,
  items: [{ entity_id: id * 10, order_item_id: 1, status: "authorized" }],
  order_id: orderId,
  status: "authorized",
  tracks: [],
  ...extra,
});

describe("Given detach asked to close the orders", () => {
  test("Then an open order the ERP lists is cancelled with a note, and its record, number and marks are handled first", async () => {
    const open = order(55, { ext_order_id: "ERP-0000001000" });
    const { commerce, deps, orderParts } = setUp([open], {
      listed: [{ number: "0000001000", purchaseOrderByCustomer: "0000055" }],
      parts: ["0000055"],
    });

    const result = await detach({ closeOrders: true }, deps);

    expect(result.closed).toEqual({
      ...NOTHING,
      cancelled: 1,
      partsRemoved: 1,
    });
    expect(orderParts.marked.get("0000055")).toBe(DAY);
    expect(commerce.calls).toEqual([
      ["markClosedByReset", "0000055"],
      ["clearExtOrderId", "55"],
      ["deleteOrderParts", "0000055"],
      ["listOrderReturns", "55"],
      ["cancel", "55"],
      ["comment", "55", CANCELLED],
    ]);
    expect(result.orders.cleared).toBe(1);
  });

  test("Then an invoiced order and an invoiced, shipped one are refunded offline and noted, never cancelled", async () => {
    const invoiced = order(56, {
      base_shipping_invoiced: 10,
      items: [line({ qty_invoiced: 2 })],
      state: "processing",
    });
    const shipped = order(57, {
      items: [line({ qty_invoiced: 2, qty_shipped: 2 })],
      state: "complete",
    });
    const { commerce, deps, orderClient } = setUp([invoiced, shipped], {
      listed: [
        { purchaseOrderByCustomer: "0000056" },
        { purchaseOrderByCustomer: "0000057" },
      ],
    });

    const result = await detach({ closeOrders: true }, deps);

    expect(commerce.orders.cancel).not.toHaveBeenCalled();
    expect(orderClient.refundOrder.mock.calls).toEqual([
      [
        { closeOrders: true },
        56,
        {
          arguments: {
            adjustment_negative: 0,
            adjustment_positive: 0,
            shipping_amount: 10,
          },
          items: [{ order_item_id: 1, qty: 2 }],
          notify: false,
        },
      ],
      [
        { closeOrders: true },
        57,
        expect.objectContaining({ items: [{ order_item_id: 1, qty: 2 }] }),
      ],
    ]);
    expect(commerce.orders.comment.mock.calls).toEqual([
      [{ closeOrders: true }, 56, REFUNDED],
      [{ closeOrders: true }, 57, REFUNDED],
    ]);
    expect(result.closed).toEqual({ ...NOTHING, refunded: 2 });
  });

  test("Then an order shipped but never invoiced is only noted and counted: Commerce credits only what was invoiced, and the rule cancels nothing shipped", async () => {
    const shipped = order(57, {
      items: [line({ qty_shipped: 1 })],
      state: "processing",
    });
    const { commerce, deps, orderClient } = setUp([shipped], {
      listed: [{ purchaseOrderByCustomer: "0000057" }],
    });

    const result = await detach({ closeOrders: true }, deps);

    expect(commerce.orders.cancel).not.toHaveBeenCalled();
    expect(orderClient.refundOrder).not.toHaveBeenCalled();
    expect(commerce.orders.comment).toHaveBeenCalledWith(
      { closeOrders: true },
      57,
      REMOVED,
    );
    expect(result.closed).toEqual({ ...NOTHING, commented: 1 });
  });

  test("Then an order in payment review, which Commerce neither cancels nor credits, is only noted", async () => {
    const review = order(58, {
      items: [line({ qty_invoiced: 2 })],
      state: "payment_review",
    });
    const { commerce, deps, orderClient } = setUp([review], {
      listed: [{ purchaseOrderByCustomer: "0000058" }],
    });
    const result = await detach({ closeOrders: true }, deps);
    expect(commerce.orders.cancel).not.toHaveBeenCalled();
    expect(orderClient.refundOrder).not.toHaveBeenCalled();
    expect(result.closed.commented).toBe(1);
  });

  test.each([["closed"], ["canceled"]])(
    "Then an order already %s is untouched: no cancel, no refund, no note",
    async (state) => {
      const done = order(58, { items: [line({ qty_invoiced: 2 })], state });
      const { commerce, deps, orderClient } = setUp([done], {
        listed: [{ purchaseOrderByCustomer: "0000058" }],
      });
      const result = await detach({ closeOrders: true }, deps);
      expect(commerce.orders.cancel).not.toHaveBeenCalled();
      expect(orderClient.refundOrder).not.toHaveBeenCalled();
      expect(commerce.orders.comment).not.toHaveBeenCalled();
      expect(result.closed).toEqual({ ...NOTHING, alreadyClosed: 1 });
    },
  );

  test("Then an open return on an invoiced order is closed before the order is refunded, written back without its comments, tracks or items", async () => {
    const invoiced = order(60, {
      items: [line({ qty_invoiced: 2, qty_shipped: 2 })],
      state: "complete",
    });
    const { commerce, deps, orderClient } = setUp([invoiced], {
      listed: [{ purchaseOrderByCustomer: "0000060" }],
      returns: [aReturn(7, 60), aReturn(8, 60, { status: "processed_closed" })],
    });

    const result = await detach({ closeOrders: true }, deps);

    const names = commerce.calls.map(([name]) => name);
    expect(names.indexOf("updateReturn")).toBeLessThan(
      names.indexOf("refundOrder"),
    );
    expect(orderClient.updateReturn).toHaveBeenCalledTimes(1);
    const [, id, written] = orderClient.updateReturn.mock.calls[0];
    expect(id).toBe(7);
    expect(written).toEqual({
      entity_id: 7,
      increment_id: "000000007",
      items: [],
      order_id: 60,
      status: "closed",
    });
    expect(orderClient.returns.get(7).status).toBe("closed");
    expect(result.closed).toEqual({
      ...NOTHING,
      refunded: 1,
      returnsClosed: 1,
    });
  });

  test("Then a return Commerce saves without closing is reported in words, and the order is still refunded", async () => {
    const invoiced = order(61, {
      items: [line({ qty_invoiced: 2 })],
      state: "processing",
    });
    const { deps } = setUp([invoiced], {
      keepOpen: [9],
      listed: [{ purchaseOrderByCustomer: "0000061" }],
      returns: [aReturn(9, 61)],
    });

    const result = await detach({ closeOrders: true }, deps);

    expect(result.closed.failed).toEqual([
      {
        error:
          "order 0000061: return 000000009: the close failed: Commerce kept it authorized",
        orderId: "0000061",
      },
    ]);
    expect(result.closed).toMatchObject({ refunded: 1, returnsClosed: 0 });
  });

  test("Then Commerce refusing the refund is reported in words and the order gets no note, so the next run tries again", async () => {
    const invoiced = order(62, {
      items: [line({ qty_invoiced: 2 })],
      state: "processing",
    });
    const { commerce, deps, orderClient } = setUp([invoiced], {
      listed: [{ purchaseOrderByCustomer: "0000062" }],
    });
    orderClient.refundOrder.mockRejectedValueOnce(
      new Error("Request failed with status code 400 Bad Request"),
    );

    const result = await detach({ closeOrders: true }, deps);

    expect(result.closed.failed).toEqual([
      {
        error:
          "order 0000062: the refund failed: Request failed with status code 400 Bad Request",
        orderId: "0000062",
      },
    ]);
    expect(commerce.orders.comment).not.toHaveBeenCalled();
    expect(result.closed.refunded).toBe(0);
  });

  test("Then a held order is taken off hold before it is cancelled, since Commerce cancels no held order", async () => {
    const held = order(59, { state: "holded" });
    const { commerce, deps } = setUp([held], {
      parts: ["0000059"],
    });

    const result = await detach({ closeOrders: true }, deps);

    const names = commerce.calls.map(([name]) => name);
    expect(names.indexOf("unholdIfHeld")).toBeLessThan(names.indexOf("cancel"));
    expect(result.holds.released).toBe(1);
    expect(result.closed.cancelled).toBe(1);
  });

  test("Then an order that only has a parts record (a split order carries no ERP number) is closed too", async () => {
    const split = order(60);
    const { commerce, deps, orderParts } = setUp([split], {
      parts: ["0000060"],
    });

    const result = await detach({ closeOrders: true }, deps);

    expect(commerce.findOrderByIncrementId).toHaveBeenCalledWith(
      { closeOrders: true },
      "0000060",
    );
    expect(orderParts.parts.size).toBe(0);
    expect(result.closed).toMatchObject({ cancelled: 1, partsRemoved: 1 });
  });

  test("Then Commerce refusing the cancel leaves a note instead, as for an order it cannot cancel", async () => {
    const { commerce, deps } = setUp([order(61)], {
      listed: [{ purchaseOrderByCustomer: "0000061" }],
    });
    commerce.orders.cancel.mockResolvedValueOnce(false);

    const result = await detach({ closeOrders: true }, deps);

    expect(commerce.orders.comment).toHaveBeenCalledWith(
      { closeOrders: true },
      61,
      REMOVED,
    );
    expect(result.closed).toMatchObject({ cancelled: 0, commented: 1 });
  });

  test("Then a failure on one order is reported in words and the others are still closed", async () => {
    const { commerce, deps } = setUp([order(62), order(63)], {
      listed: [
        { purchaseOrderByCustomer: "0000062" },
        { purchaseOrderByCustomer: "0000063" },
      ],
    });
    commerce.orders.cancel.mockRejectedValueOnce(new Error("locked"));

    const result = await detach({ closeOrders: true }, deps);

    expect(result.closed.failed).toEqual([
      {
        error: "order 0000062: the cancel failed: locked",
        orderId: "0000062",
      },
    ]);
    expect(result.closed.cancelled).toBe(1);
  });

  test("Then an order already closed by a reset (its history says so) gets no second note and no cancel", async () => {
    const closed = order(64, {
      state: "canceled",
      status_histories: [
        { comment: "Cancelled by the demo reset on 2026-09-27." },
      ],
    });
    const { commerce, deps } = setUp([closed], {
      listed: [{ purchaseOrderByCustomer: "0000064" }],
    });

    const result = await detach({ closeOrders: true }, deps);

    expect(commerce.orders.cancel).not.toHaveBeenCalled();
    expect(commerce.orders.comment).not.toHaveBeenCalled();
    expect(result.closed).toMatchObject({
      alreadyClosed: 1,
      cancelled: 0,
      commented: 0,
    });
  });

  test("Then an order two ERPs both list is closed once", async () => {
    const shared = order(65);
    const { commerce, deps } = setUp([shared]);
    deps.erps = [
      { adapter: "demo-erp", connection: { baseUrl: "https://a" }, id: "erp" },
      { adapter: "demo-erp", connection: { baseUrl: "https://b" }, id: "b" },
    ];
    deps.erp = listing([{ purchaseOrderByCustomer: "0000065" }]);

    const result = await detach({ closeOrders: true }, deps);

    expect(commerce.orders.cancel).toHaveBeenCalledTimes(1);
    expect(result.closed.cancelled).toBe(1);
  });
});

describe("Given detach without closeOrders", () => {
  test("Then no order is read, marked, cancelled or noted, and the answer carries no closing counts", async () => {
    const { commerce, deps, orderParts } = setUp([order(55)], {
      listed: [{ purchaseOrderByCustomer: "0000055" }],
      parts: ["0000055"],
    });

    const result = await detach({}, deps);

    expect(result).not.toHaveProperty("closed");
    expect(commerce.orders.get).not.toHaveBeenCalled();
    expect(commerce.orders.cancel).not.toHaveBeenCalled();
    expect(orderParts.markClosedByReset).not.toHaveBeenCalled();
    expect(orderParts.parts.size).toBe(1);
  });
});
