/*
 * erp/detach with closeOrders (AB-16n, owner 2026-09-28): before the ERPs are wiped, every order
 * they hold is closed off in Commerce. An order Commerce can still cancel (nothing invoiced,
 * nothing shipped) is cancelled with a note; any other is only noted, since its ERP documents are
 * about to go. Its parts record goes, its ERP number goes, and its hold comes off. Every order is
 * marked closed BEFORE the first Commerce write, so the order events those writes raise send
 * nothing to an ERP.
 */
// biome-ignore-all lint/suspicious/useAwait: the fakes answer promises without waiting on anything; the real collaborators are async and detach awaits them
import { detach } from "#lib/detach";

const DAY = "2026-09-28";
const CANCELLED = `Canceled by the demo reset on ${DAY}.`;
const REMOVED = `The ERP documents for this order were removed by the demo reset on ${DAY}.`;

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

function setUp(orders, { listed = [], parts = [] } = {}) {
  const commerce = fakeCommerce(orders);
  const orderParts = fakeOrderParts(parts, commerce.calls);
  const deps = {
    commerce,
    erp: listing(listed),
    ledger,
    orderParts,
    today: () => DAY,
  };
  return { commerce, deps, orderParts };
}

describe("Given detach asked to close the orders", () => {
  test("Then an open order the ERP lists is cancelled with a note, and its record, number and marks are handled first", async () => {
    const open = order(55, { ext_order_id: "ERP-0000001000" });
    const { commerce, deps, orderParts } = setUp([open], {
      listed: [{ commerceOrderId: "55", number: "0000001000" }],
      parts: ["0000055"],
    });

    const result = await detach({ closeOrders: true }, deps);

    expect(result.closed).toEqual({
      alreadyClosed: 0,
      cancelled: 1,
      commented: 0,
      failed: [],
      partsRemoved: 1,
    });
    expect(orderParts.marked.get("0000055")).toBe(DAY);
    expect(commerce.calls).toEqual([
      ["markClosedByReset", "0000055"],
      ["clearExtOrderId", "55"],
      ["deleteOrderParts", "0000055"],
      ["cancel", "55"],
      ["comment", "55", CANCELLED],
    ]);
    expect(result.orders.cleared).toBe(1);
  });

  test("Then an invoiced order and a shipped order are only noted, never cancelled", async () => {
    const invoiced = order(56, { items: [line({ qty_invoiced: 2 })] });
    const shipped = order(57, {
      items: [line({ qty_shipped: 1 })],
      state: "processing",
    });
    const { commerce, deps } = setUp([invoiced, shipped], {
      listed: [{ commerceOrderId: "56" }, { commerceOrderId: "57" }],
    });

    const result = await detach({ closeOrders: true }, deps);

    expect(commerce.orders.cancel).not.toHaveBeenCalled();
    expect(commerce.orders.comment.mock.calls).toEqual([
      [{ closeOrders: true }, 56, REMOVED],
      [{ closeOrders: true }, 57, REMOVED],
    ]);
    expect(result.closed).toMatchObject({ cancelled: 0, commented: 2 });
  });

  test.each([["complete"], ["closed"], ["canceled"], ["payment_review"]])(
    "Then an order in state %s is only noted",
    async (state) => {
      const { commerce, deps } = setUp([order(58, { state })], {
        listed: [{ commerceOrderId: "58" }],
      });
      const result = await detach({ closeOrders: true }, deps);
      expect(commerce.orders.cancel).not.toHaveBeenCalled();
      expect(result.closed.commented).toBe(1);
    },
  );

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
      listed: [{ commerceOrderId: "61" }],
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
      listed: [{ commerceOrderId: "62" }, { commerceOrderId: "63" }],
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
      listed: [{ commerceOrderId: "64" }],
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
    deps.erp = listing([{ commerceOrderId: "65" }]);

    const result = await detach({ closeOrders: true }, deps);

    expect(commerce.orders.cancel).toHaveBeenCalledTimes(1);
    expect(result.closed.cancelled).toBe(1);
  });
});

describe("Given detach without closeOrders", () => {
  test("Then no order is read, marked, cancelled or noted, and the answer carries no closing counts", async () => {
    const { commerce, deps, orderParts } = setUp([order(55)], {
      listed: [{ commerceOrderId: "55" }],
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
