/*
 * The integration moves a Commerce return's statuses as each ERP takes its lines (returns-design
 * r1; live test R-T2 answered yes 2026-10-02): authorized when an ERP accepts its return order,
 * received when its goods are back, approved when it credits them. The return is read first and
 * written back with its header whole, because a write without its increment_id renumbers it,
 * and with only the items this write moves, because Commerce refuses to save an item that is
 * already approved ("Could not save the RMA entity", live on Justrite 2026-10-02).
 */
import {
  moveReturnItems,
  nextReturn,
  RETURN_STATUS,
} from "#router/return-statuses";

/** A return of two lines: item 11 (order line 38, Accuform's), item 12 (order line 40, Justrite's). */
function aReturn(over = {}) {
  return {
    comments: [{ comment: "made by staff" }],
    customer_id: 3,
    date_requested: "2026-10-02 10:00:00",
    entity_id: 4,
    increment_id: "000000004",
    items: [
      {
        condition: "9",
        entity_id: 11,
        order_item_id: 38,
        qty_approved: null,
        qty_authorized: null,
        qty_requested: 2,
        qty_returned: null,
        reason: "8",
        resolution: "5",
        rma_entity_id: 4,
        status: "pending",
      },
      {
        condition: "9",
        entity_id: 12,
        order_item_id: 40,
        qty_approved: null,
        qty_authorized: null,
        qty_requested: 1,
        qty_returned: null,
        reason: "8",
        resolution: "5",
        rma_entity_id: 4,
        status: "pending",
      },
    ],
    order_id: 31,
    order_increment_id: "5000000002",
    status: "pending",
    store_id: 1,
    tracks: [],
    ...over,
  };
}

const ROUTED = new Set([11, 12]);

describe("Given one ERP accepts its lines of a two-ERP return", () => {
  test("Then its item is authorized for the quantity sent, and the return is partly authorized", () => {
    const next = nextReturn(
      aReturn(),
      new Map([[11, 2]]),
      "authorized",
      ROUTED,
    );

    expect(next.items[0]).toMatchObject({
      entity_id: 11,
      qty_authorized: 2,
      status: "authorized",
    });
    expect(next.items[1]).toEqual(aReturn().items[1]);
    expect(next.status).toBe(RETURN_STATUS.partlyAuthorized);
    expect(RETURN_STATUS.partlyAuthorized).toBe("partially_authorized");
  });

  test("Then the return goes back whole: its number, every item field, and no comments or tracks", () => {
    const next = nextReturn(
      aReturn(),
      new Map([[11, 2]]),
      "authorized",
      ROUTED,
    );

    expect(next).toMatchObject({
      customer_id: 3,
      date_requested: "2026-10-02 10:00:00",
      entity_id: 4,
      increment_id: "000000004",
      order_id: 31,
      order_increment_id: "5000000002",
      store_id: 1,
    });
    expect(next.items[0]).toMatchObject({
      condition: "9",
      order_item_id: 38,
      qty_requested: 2,
      reason: "8",
      resolution: "5",
      rma_entity_id: 4,
    });
    // Sub-records, written through their own routes; sent back they could be saved twice.
    expect(next).not.toHaveProperty("comments");
    expect(next).not.toHaveProperty("tracks");
  });

  test("Then once both ERPs accepted, the return is authorized", () => {
    const half = nextReturn(
      aReturn(),
      new Map([[11, 2]]),
      "authorized",
      ROUTED,
    );
    const next = nextReturn(half, new Map([[12, 1]]), "authorized", ROUTED);

    expect(next.status).toBe("authorized");
  });

  test("Then a line no ERP took does not hold the return back from authorized", () => {
    const next = nextReturn(
      aReturn(),
      new Map([[11, 2]]),
      "authorized",
      new Set([11]),
    );

    expect(next.status).toBe("authorized");
    expect(next.items[1].status).toBe("pending");
  });

  test("Then the same write again changes nothing, and nothing is to be written", () => {
    const once = nextReturn(
      aReturn(),
      new Map([[11, 2]]),
      "authorized",
      ROUTED,
    );

    expect(
      nextReturn(once, new Map([[11, 2]]), "authorized", ROUTED),
    ).toBeNull();
  });
});

describe("Given an ERP's goods are back", () => {
  test("Then its item is received for that quantity, and the return is partly received while the other ERP's are not", () => {
    const authorized = nextReturn(
      aReturn(),
      new Map([
        [11, 2],
        [12, 1],
      ]),
      "authorized",
      ROUTED,
    );
    const next = nextReturn(authorized, new Map([[11, 2]]), "received", ROUTED);

    expect(next.items[0]).toMatchObject({
      qty_authorized: 2,
      qty_returned: 2,
      status: "received",
    });
    expect(next.status).toBe(RETURN_STATUS.partlyReceived);
  });

  test("Then goods received before the authorization was written are authorized for that quantity too", () => {
    const next = nextReturn(
      aReturn(),
      new Map([
        [11, 2],
        [12, 1],
      ]),
      "received",
      ROUTED,
    );

    expect(next.items[0]).toMatchObject({
      qty_authorized: 2,
      qty_returned: 2,
      status: "received",
    });
    expect(next.status).toBe("received");
  });

  test("Then a late authorization never moves a received item or the return back", () => {
    const received = nextReturn(
      aReturn(),
      new Map([
        [11, 2],
        [12, 1],
      ]),
      "received",
      ROUTED,
    );

    expect(
      nextReturn(received, new Map([[11, 2]]), "authorized", ROUTED),
    ).toBeNull();
  });
});

describe("Given an ERP credits its lines", () => {
  test("Then its item is approved for the credited quantity; the return closes only when every routed item is approved", () => {
    const received = nextReturn(
      aReturn(),
      new Map([
        [11, 2],
        [12, 1],
      ]),
      "received",
      ROUTED,
    );
    const half = nextReturn(received, new Map([[11, 2]]), "approved", ROUTED);

    expect(half.items[0]).toMatchObject({
      qty_approved: 2,
      status: "approved",
    });
    expect(half.status).toBe("received");

    const all = nextReturn(half, new Map([[12, 1]]), "approved", ROUTED);
    expect(all.status).toBe("processed_closed");
  });
});

describe("Given the return is moved in Commerce", () => {
  test("Then it is read, then written back once with only the statuses and quantities changed", async () => {
    const getReturn = vi.fn(async () => aReturn());
    const updateReturn = vi.fn(async () => ({}));

    const moved = await moveReturnItems({ p: 1 }, 4, {
      deps: { getReturn, updateReturn },
      moves: new Map([[11, 2]]),
      routed: ROUTED,
      stage: "authorized",
    });

    expect(moved).toBe(true);
    expect(getReturn).toHaveBeenCalledExactlyOnceWith({ p: 1 }, 4);
    const [[params, id, rma]] = updateReturn.mock.calls;
    expect([params, id]).toEqual([{ p: 1 }, 4]);
    const whole = nextReturn(
      aReturn(),
      new Map([[11, 2]]),
      "authorized",
      ROUTED,
    );
    expect(rma).toEqual({ ...whole, items: [whole.items[0]] });
    expect(rma.increment_id).toBe("000000004");
  });

  test("Then an item already approved is left out of the write, and the return still closes", async () => {
    // Live on Justrite 2026-10-02 (return 3): one ERP's line approved, the other's received;
    // the second ERP's credit wrote both items and Commerce answered 400 "Could not save the
    // RMA entity". The same write with only the moving item closed the return.
    const halfApproved = aReturn({
      items: aReturn().items.map((item) =>
        item.entity_id === 12
          ? {
              ...item,
              qty_approved: 1,
              qty_authorized: 1,
              qty_returned: 1,
              status: "approved",
            }
          : { ...item, qty_authorized: 2, qty_returned: 2, status: "received" },
      ),
      status: "received",
    });
    const getReturn = vi.fn(async () => halfApproved);
    const updateReturn = vi.fn(async () => ({}));

    await moveReturnItems({}, 4, {
      deps: { getReturn, updateReturn },
      moves: new Map([[11, 2]]),
      routed: ROUTED,
      stage: "approved",
    });

    const [[, , rma]] = updateReturn.mock.calls;
    expect(rma.items.map((item) => [item.entity_id, item.status])).toEqual([
      [11, "approved"],
    ]);
    expect(rma.status).toBe("processed_closed");
  });

  test("Then nothing is written when nothing would change", async () => {
    const already = nextReturn(
      aReturn(),
      new Map([[11, 2]]),
      "authorized",
      ROUTED,
    );
    const updateReturn = vi.fn();

    const moved = await moveReturnItems({}, 4, {
      deps: { getReturn: async () => already, updateReturn },
      moves: new Map([[11, 2]]),
      routed: ROUTED,
      stage: "authorized",
    });

    expect(moved).toBe(false);
    expect(updateReturn).not.toHaveBeenCalled();
  });
});
