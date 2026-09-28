/* What the Activity section says about each scheduled run (erp/history?scheduled=true). */
import {
  nextPublish,
  publishLine,
  scheduledRunRows,
} from "#web/scheduled-view.js";

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

describe("Given the band's one line about the price publish", () => {
  const now = new Date("2026-09-28T14:40:00Z");

  test("Then the next run is the next five past the hour, in UTC", () => {
    expect(nextPublish(now).toISOString()).toBe("2026-09-28T15:05:00.000Z");
    expect(nextPublish(new Date("2026-09-28T14:03:00Z")).toISOString()).toBe(
      "2026-09-28T14:05:00.000Z",
    );
    expect(nextPublish(new Date("2026-09-28T14:05:00Z")).toISOString()).toBe(
      "2026-09-28T15:05:00.000Z",
    );
  });

  test("Then it says when it next runs and how the last run went", () => {
    const quiet = {
      at: "2026-09-28T14:05:00Z",
      failed: 0,
      removed: 0,
      unchanged: 14,
      written: 0,
    };
    expect(publishLine([run(quiet)], now, (t) => `[${t}]`)).toStrictEqual({
      last: "last ran [2026-09-28T14:05:00Z], nothing changed",
      next: "[2026-09-28T15:05:00.000Z]",
    });
    expect(publishLine([], now, (t) => t).last).toBe("has not run yet");
    expect(
      publishLine(
        [run({ at: "T", error: "Contoso ERP answered 503" })],
        now,
        (t) => t,
      ).last,
    ).toBe("last ran T, failed, Contoso ERP answered 503");
  });
});
