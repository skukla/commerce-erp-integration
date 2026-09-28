/*
 * The combined order status, Phase B slice B2 (design v1 §3.3): one rule over every part's
 * outcome, and the only writer of the hold it implies. Pending until every part is sent; On
 * Hold while any part is held, failed, cancelled by its ERP, or a line reached no ERP;
 * Processing while parts are moving. Complete is Commerce's own; the order is never cancelled
 * automatically.
 */
import {
  applyCombinedStatus,
  combinedStatus,
  decideOrderAction,
  setWholeOrderHold,
} from "#router/combined-status";

const CANCEL_THE_ORDER = /cancel the order/u;

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
    [["held", "sent"], "on-hold"],
    [["failed", "sent"], "on-hold"],
    [["held", "sending"], "on-hold"],
    [["cancelled", "shipped"], "on-hold"],
    [["cancelled", "cancelled"], "on-hold"],
  ])("Then %j combine to %s", (statuses, expected) => {
    expect(combinedStatus({ parts: parts(...statuses) }).status).toBe(expected);
  });

  test("Then a line that reached no ERP, or two, holds the order for staff", () => {
    expect(
      combinedStatus({ parts: parts("sent"), unrouted: ["X9"] }).status,
    ).toBe("on-hold");
    expect(
      combinedStatus({
        conflicts: [{ erps: ["a", "b"], sku: "X" }],
        parts: parts("sent"),
      }).status,
    ).toBe("on-hold");
  });

  test("Then every part cancelled asks staff to cancel; the order is never cancelled automatically", () => {
    const decision = combinedStatus({ parts: parts("cancelled", "cancelled") });
    expect(decision.status).toBe("on-hold");
    expect(decision.reason).toMatch(CANCEL_THE_ORDER);
  });
});

describe("Given a combined status and the order's state in Commerce", () => {
  test.each([
    ["on-hold", "new", "hold"],
    ["on-hold", "processing", "hold"],
    ["on-hold", "holded", "none"],
    ["processing", "holded", "release"],
    ["pending", "holded", "release"],
    ["processing", "processing", "none"],
    ["on-hold", "complete", "none"],
    ["on-hold", "canceled", "none"],
    ["processing", "closed", "none"],
  ])("Then %s over %s means %s", (status, state, action) => {
    expect(decideOrderAction(status, state)).toBe(action);
  });
});

function client(state) {
  return {
    getOrder: vi.fn(async () => ({ state })),
    holdOrder: vi.fn(async () => true),
    unholdOrder: vi.fn(async () => true),
  };
}

describe("Given the router writes the combined status", () => {
  test("Then a held part puts the order On Hold", async () => {
    const c = client("new");
    const result = await applyCombinedStatus(
      {},
      55,
      { parts: parts("held", "sent") },
      c,
    );
    expect(c.holdOrder).toHaveBeenCalledWith({}, 55);
    expect(result).toMatchObject({ action: "hold", status: "on-hold" });
  });

  test("Then the last held part released takes the order off hold", async () => {
    const c = client("holded");
    await applyCombinedStatus({}, 55, { parts: parts("sent", "sent") }, c);
    expect(c.unholdOrder).toHaveBeenCalledWith({}, 55);
  });

  test("Then nothing is written when the order already says what the parts say", async () => {
    const c = client("holded");
    await applyCombinedStatus({}, 55, { parts: parts("held") }, c);
    expect(c.holdOrder).not.toHaveBeenCalled();
    expect(c.unholdOrder).not.toHaveBeenCalled();
  });
});

describe("Given one ERP and the whole order", () => {
  test("Then held puts it On Hold once, released takes it off once", async () => {
    const onHold = client("holded");
    await setWholeOrderHold({}, 55, true, onHold);
    expect(onHold.holdOrder).not.toHaveBeenCalled();
    await setWholeOrderHold({}, 55, false, onHold);
    expect(onHold.unholdOrder).toHaveBeenCalledWith({}, 55);
    const open = client("new");
    await setWholeOrderHold({}, 55, true, open);
    expect(open.holdOrder).toHaveBeenCalledWith({}, 55);
    await setWholeOrderHold({}, 55, false, open);
    expect(open.unholdOrder).not.toHaveBeenCalled();
  });
});
