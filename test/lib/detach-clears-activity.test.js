/*
 * A reset starts the Admin page's Activity again (AB-16n, owner 2026-09-28): once detach has
 * closed off the orders, the integration's history and scheduled-run records describe ERP
 * records the reset is about to wipe, so they go, and one line says the reset happened. A
 * detach that is not a reset (removing the integration, one ERP's undo) leaves them alone.
 */
// biome-ignore-all lint/suspicious/useAwait: the fakes answer promises without waiting on anything; the real collaborators are async and detach awaits them
import { detach } from "#lib/detach";

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
      `Demo reset on ${DAY}: 0 orders cancelled, 0 noted as closed, the ERPs' changes in Commerce undone. The activity before it was cleared.`,
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
