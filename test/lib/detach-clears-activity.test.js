/*
 * A reset starts the Admin page's Activity again (AB-16n, owner 2026-09-28): once detach has
 * closed off the orders, the integration's history and scheduled-run records describe ERP
 * records the reset is about to wipe, so they are cleared, and one line says the reset happened.
 * What clearing a scheduled run keeps (the moment it last ran for, so the reset does not make it
 * due) is test/lib/scheduled-runs.test.js. A detach that is not a reset (removing the
 * integration, one ERP's undo) leaves them alone.
 */
// biome-ignore-all lint/suspicious/useAwait: the fakes answer promises without waiting on anything; the real collaborators are async and detach awaits them
import { detach, resetLine } from "#lib/detach";

const DAY = "2026-09-28";

function setUp() {
  const calls = [];
  const activity = {
    clearHistory: vi.fn(async () => {
      calls.push("clearHistory");
      return 5;
    }),
    clearScheduledRuns: vi.fn(async () => {
      calls.push("clearScheduledRuns");
      return 1;
    }),
    recordReset: vi.fn(async (message) => {
      calls.push(["recordReset", message]);
    }),
  };
  const deps = {
    activity,
    commerce: {},
    erp: {
      listOrders: vi.fn(async () => ({
        data: { items: [] },
        ok: true,
        status: 200,
      })),
    },
    ledger: { revertLedger: vi.fn(async () => ({ failed: [], reverted: 0 })) },
    orderParts: {
      listOrderPartsIds: vi.fn(async () => []),
      readOrderParts: vi.fn(async () => ({ parts: {} })),
    },
    today: () => DAY,
  };
  return { activity, calls, deps };
}

describe("Given a reset's detach (closeOrders)", () => {
  test("Then the history and the scheduled runs are cleared, and one line records the reset", async () => {
    const { activity, calls, deps } = setUp();

    const result = await detach({ closeOrders: true }, deps);

    expect(calls[0]).toBe("clearHistory");
    expect(calls[1]).toBe("clearScheduledRuns");
    expect(calls[2][0]).toBe("recordReset");
    expect(activity.recordReset.mock.calls[0][0]).toBe(
      `Demo reset on ${DAY}: no orders to close; the ERPs' changes in Commerce undone. The activity before it was cleared.`,
    );
    expect(result.activity).toEqual({ historyCleared: 5, scheduledCleared: 1 });
  });
});

describe("Given a detach that is not a reset (removing the integration)", () => {
  test("Then the activity is left alone", async () => {
    const { activity, deps } = setUp();

    const result = await detach({}, deps);

    expect(activity.clearHistory).not.toHaveBeenCalled();
    expect(activity.recordReset).not.toHaveBeenCalled();
    expect(result.activity).toBeUndefined();
  });
});

describe("Given what a reset closed", () => {
  test.each([
    [
      { cancelled: 21, commented: 3 },
      "21 orders canceled, 3 noted as closed; the ERPs' changes in Commerce undone.",
    ],
    [
      { cancelled: 1, commented: 0 },
      "1 order canceled; the ERPs' changes in Commerce undone.",
    ],
    [
      { cancelled: 0, commented: 2 },
      "2 orders noted as closed; the ERPs' changes in Commerce undone.",
    ],
    [
      { cancelled: 0, commented: 0 },
      "no orders to close; the ERPs' changes in Commerce undone.",
    ],
  ])("Then the reset's line says only what it did (%o)", (closed, said) => {
    expect(resetLine(DAY, closed)).toBe(
      `Demo reset on ${DAY}: ${said} The activity before it was cleared.`,
    );
  });
});
