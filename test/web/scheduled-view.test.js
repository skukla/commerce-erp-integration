/* What the Activity section says about each scheduled run (erp/history?scheduled=true). */
import { scheduledRunRows } from "#web/scheduled-view.js";

const run = (lastRun, lastChange = null) => ({
  id: "prices",
  lastChange,
  lastRun,
});

describe("Given the scheduled runs", () => {
  test("Then the price publish says when it runs, when it last ran, and what it changed", () => {
    const at = "2026-09-28T14:05:00.000Z";
    const figures = { at, failed: 0, removed: 1, unchanged: 120, written: 3 };
    expect(scheduledRunRows([run(figures, figures)], (t) => `[${t}]`)).toEqual([
      {
        id: "prices",
        lastChange: "[2026-09-28T14:05:00.000Z]: 3 written, 1 removed.",
        lastRun:
          "[2026-09-28T14:05:00.000Z]: 3 written, 1 removed, 120 unchanged.",
        schedule: "Every hour at five past (an App Builder alarm, in UTC)",
        title:
          "Price publish: each ERP's prices in force into the shared catalogs",
      },
    ]);
  });

  test("Then a run that changed nothing, or failed, says so", () => {
    const quiet = { at: "T2", failed: 0, removed: 0, unchanged: 5, written: 0 };
    expect(scheduledRunRows([run(quiet)], (t) => t)[0]).toMatchObject({
      lastChange: "No change yet.",
      lastRun: "T2: nothing changed, 5 unchanged.",
    });
    expect(
      scheduledRunRows([run({ at: "T3", error: "state down" })], (t) => t)[0]
        .lastRun,
    ).toBe("T3: failed, state down.");
    expect(
      scheduledRunRows(
        [run({ at: "T4", failed: 2, removed: 0, unchanged: 5, written: 1 })],
        (t) => t,
      )[0].lastRun,
    ).toBe("T4: 1 written, 5 unchanged, 2 not published.");
  });

  test("Then the price publish is listed before it has ever run", () => {
    expect(scheduledRunRows([], (t) => t)).toEqual([
      expect.objectContaining({
        id: "prices",
        lastChange: "No change yet.",
        lastRun: "Has not run yet.",
      }),
    ]);
  });
});
