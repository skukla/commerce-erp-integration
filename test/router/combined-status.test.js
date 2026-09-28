/*
 * The combined order status (design v1 §3.3, revised by the owner 2026-09-28): one rule over
 * every part's outcome, and the only writer of what it implies. Commerce's On Hold only while
 * EVERY part is held (Commerce will not ship or invoice an order On Hold, so holding the whole
 * order for one ERP's part would stop the others); while SOME parts are held the order keeps its
 * state with the custom status "Partially Held" and a note naming the waiting ERP. Pending until
 * every part is sent; Processing while parts are moving. Complete is Commerce's own; the order is
 * never cancelled automatically.
 */
import {
  applyCombinedStatus,
  combinedStatus,
  decideOrderAction,
  PARTIALLY_HELD,
  setWholeOrderHold,
} from "#router/combined-status";

const CANCEL_THE_ORDER = /cancel the order/u;
const WAITING_ON_A = /waiting on erp-0 \(held\)/u;
const NOT_OF_STATE = Object.assign(
  new Error(
    'Request failed with status code 400 Bad Request: The status "partially_held" is not part of the order status history.',
  ),
  { response: { status: 400 } },
);

const part = (status) => ({ skus: ["X"], status });
const parts = (...statuses) =>
  Object.fromEntries(statuses.map((s, i) => [`erp-${i}`, part(s)]));

describe("Given the parts of an order", () => {
  test.each([
    [["sending", "sent"], "pending"],
    [["sent", "sent"], "processing"],
    [["sent", "confirmed"], "processing"],
    [["shipped", "invoiced"], "processing"],
    [["sent", "skipped"], "processing"],
    [["sent", "dropped"], "processing"],
    // Some parts held while others move: the order keeps moving, "Partially Held".
    [["held", "sent"], "partially-held"],
    [["failed", "sent"], "partially-held"],
    [["held", "sending"], "partially-held"],
    [["cancelled", "shipped"], "partially-held"],
    // Every part held: Commerce's own On Hold.
    [["held"], "on-hold"],
    [["held", "failed"], "on-hold"],
    [["cancelled", "cancelled"], "on-hold"],
  ])("Then %j combine to %s", (statuses, expected) => {
    expect(combinedStatus({ parts: parts(...statuses) }).status).toBe(expected);
  });

  test("Then a line that reached no ERP, or two, waits for staff while the rest moves", () => {
    expect(
      combinedStatus({ parts: parts("sent"), unrouted: ["X9"] }).status,
    ).toBe("partially-held");
    expect(
      combinedStatus({
        conflicts: [{ erps: ["a", "b"], sku: "X" }],
        parts: parts("sent"),
      }).status,
    ).toBe("partially-held");
    expect(combinedStatus({ parts: {}, unrouted: ["X9"] }).status).toBe(
      "on-hold",
    );
  });

  test("Then every part cancelled asks staff to cancel; the order is never cancelled automatically", () => {
    const decision = combinedStatus({ parts: parts("cancelled", "cancelled") });
    expect(decision.status).toBe("on-hold");
    expect(decision.reason).toMatch(CANCEL_THE_ORDER);
  });

  test("Then a partially held order names the waiting ERP and why", () => {
    expect(combinedStatus({ parts: parts("held", "sent") }).reason).toMatch(
      WAITING_ON_A,
    );
  });
});

describe("Given a combined status and the order in Commerce", () => {
  test.each([
    ["on-hold", "new", undefined, "hold"],
    ["on-hold", "processing", undefined, "hold"],
    ["on-hold", "holded", undefined, "none"],
    ["processing", "holded", undefined, "release"],
    ["pending", "holded", undefined, "release"],
    ["processing", "processing", undefined, "none"],
    ["on-hold", "complete", undefined, "none"],
    ["on-hold", "canceled", undefined, "none"],
    ["processing", "closed", undefined, "none"],
    ["partially-held", "processing", "processing", "mark-partially-held"],
    ["partially-held", "new", "pending", "mark-partially-held"],
    ["partially-held", "processing", PARTIALLY_HELD, "none"],
    ["partially-held", "holded", "holded", "release-partially-held"],
    ["partially-held", "complete", "complete", "none"],
    ["processing", "processing", PARTIALLY_HELD, "clear-partially-held"],
    ["pending", "new", PARTIALLY_HELD, "clear-partially-held"],
  ])(
    "Then %s over %s (status %s) means %s",
    (status, state, current, action) => {
      expect(decideOrderAction(status, state, current)).toBe(action);
    },
  );
});

/** A fake order client; `moves` lets hold and unhold change the order as Commerce would. */
function client(state, status = state, moves = true) {
  const order = { state, status };
  return {
    addComment: vi.fn(async () => ({})),
    getOrder: vi.fn(async () => ({ ...order })),
    holdOrder: vi.fn(() => {
      if (moves) {
        order.state = "holded";
        order.status = "holded";
      }
      return Promise.resolve(true);
    }),
    order,
    unholdOrder: vi.fn(() => {
      if (moves) {
        order.state = "processing";
        order.status = "processing";
      }
      return Promise.resolve(true);
    }),
  };
}

const statusOf = (c) =>
  c.addComment.mock.calls.map(([, , body]) => body.statusHistory.status);

describe("Given the router writes the combined status", () => {
  test("Then every part held puts the order On Hold", async () => {
    const c = client("new", "pending");
    const result = await applyCombinedStatus(
      {},
      55,
      { parts: parts("held", "failed") },
      c,
    );
    expect(c.holdOrder).toHaveBeenCalledWith({}, 55);
    expect(result).toMatchObject({ action: "hold", status: "on-hold" });
  });

  test("Then one part held while another moves never holds the order: it is marked Partially Held with a note", async () => {
    const c = client("processing");
    const result = await applyCombinedStatus(
      {},
      55,
      { parts: parts("held", "sent") },
      c,
    );
    expect(c.holdOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: "mark-partially-held",
      status: "partially-held",
    });
    expect(c.addComment).toHaveBeenCalledExactlyOnceWith({}, 55, {
      statusHistory: {
        comment: expect.stringMatching(WAITING_ON_A),
        is_customer_notified: 0,
        is_visible_on_front: 0,
        status: PARTIALLY_HELD,
      },
    });
  });

  test("Then an order On Hold whose part is released while another still waits comes off hold and is marked Partially Held", async () => {
    const c = client("holded");
    await applyCombinedStatus({}, 55, { parts: parts("held", "sent") }, c);
    expect(c.unholdOrder).toHaveBeenCalledWith({}, 55);
    expect(c.holdOrder).not.toHaveBeenCalled();
    expect(statusOf(c)).toEqual([PARTIALLY_HELD]);
  });

  test("Then the last waiting part released returns the status to the state's own and says so", async () => {
    const c = client("processing", PARTIALLY_HELD);
    const result = await applyCombinedStatus(
      {},
      55,
      { parts: parts("sent", "sent") },
      c,
    );
    expect(result.action).toBe("clear-partially-held");
    expect(statusOf(c)).toEqual(["processing"]);
  });

  test("Then the last held part released takes the order off hold", async () => {
    const c = client("holded");
    await applyCombinedStatus({}, 55, { parts: parts("sent", "sent") }, c);
    expect(c.unholdOrder).toHaveBeenCalledWith({}, 55);
  });

  test("Then nothing is written when the order already says what the parts say", async () => {
    const held = client("holded");
    await applyCombinedStatus({}, 55, { parts: parts("held") }, held);
    const partiallyHeld = client("processing", PARTIALLY_HELD);
    await applyCombinedStatus(
      {},
      55,
      { parts: parts("held", "sent") },
      partiallyHeld,
    );
    for (const c of [held, partiallyHeld]) {
      expect(c.holdOrder).not.toHaveBeenCalled();
      expect(c.unholdOrder).not.toHaveBeenCalled();
      expect(c.addComment).not.toHaveBeenCalled();
    }
  });

  test("Then a Partially Held status Commerce refuses (not assigned to the state) leaves the note alone, and the event succeeds", async () => {
    const c = client("processing");
    c.addComment.mockRejectedValueOnce(NOT_OF_STATE);
    const logger = { warn: vi.fn() };
    const result = await applyCombinedStatus(
      {},
      55,
      { parts: parts("held", "sent") },
      c,
      logger,
    );
    expect(result.status).toBe("partially-held");
    expect(c.addComment).toHaveBeenCalledTimes(2);
    expect(c.addComment.mock.calls[1][2].statusHistory).not.toHaveProperty(
      "status",
    );
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe("Given one ERP and the whole order", () => {
  test("Then held puts it On Hold once, released takes it off once", async () => {
    const onHold = client("holded", "holded", false);
    await setWholeOrderHold({}, 55, true, onHold);
    expect(onHold.holdOrder).not.toHaveBeenCalled();
    await setWholeOrderHold({}, 55, false, onHold);
    expect(onHold.unholdOrder).toHaveBeenCalledWith({}, 55);
    const open = client("new", "pending", false);
    await setWholeOrderHold({}, 55, true, open);
    expect(open.holdOrder).toHaveBeenCalledWith({}, 55);
    await setWholeOrderHold({}, 55, false, open);
    expect(open.unholdOrder).not.toHaveBeenCalled();
  });

  test("Then its one part held is every part: the order goes On Hold as before", async () => {
    const c = client("new", "pending");
    const result = await applyCombinedStatus(
      {},
      55,
      { parts: { erp: part("held") } },
      c,
    );
    expect(result.action).toBe("hold");
    expect(c.holdOrder).toHaveBeenCalledOnce();
  });
});
