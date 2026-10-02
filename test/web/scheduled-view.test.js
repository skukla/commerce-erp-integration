/* What the Activity section says about each scheduled run (erp/history?scheduled=true). */
import {
  nextPublish,
  publishLine,
  scheduledRunRows,
} from "#web/scheduled-view.js";

/** The default schedule, as erp/history?scheduled=true answers it (lib/schedule.js). */
const HOURLY = {
  enabled: true,
  frequency: "hourly",
  minute: 5,
  time: "02:00",
  timeZone: "UTC",
  weekday: "monday",
};
const CHICAGO_DAILY = {
  ...HOURLY,
  frequency: "daily",
  time: "02:00",
  timeZone: "America/Chicago",
};
const OFF = { ...HOURLY, enabled: false };

const run = (lastRun, lastChange = null, schedule = HOURLY) => ({
  id: "prices",
  lastChange,
  lastRun,
  schedule,
});
const unrun = (schedule) => ({ id: "prices", schedule });

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
        schedule: "Every hour at :05, store time (UTC)",
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
    expect(scheduledRunRows([unrun(HOURLY)], (t) => t)).toEqual([
      expect.objectContaining({
        id: "prices",
        lastChange: "No change yet.",
        lastRun: "Has not run yet.",
      }),
    ]);
  });

  // A demo reset forgets a job's last run and keeps only the moment it last ran for
  // (lib/scheduled-runs.js clearScheduledRuns): the page reads that as not yet run.
  test("Then a job a reset cleared, left with only its moment, reads as not yet run", () => {
    const cleared = {
      id: "prices",
      lastMoment: "2026-09-28T14:05:00.000Z",
      schedule: HOURLY,
    };
    expect(scheduledRunRows([cleared], (t) => t)).toEqual([
      expect.objectContaining({
        id: "prices",
        lastChange: "No change yet.",
        lastRun: "Has not run yet.",
      }),
    ]);
    const now = new Date("2026-09-28T14:40:00Z");
    expect(publishLine([cleared], now, (t) => t)).toStrictEqual({
      last: "has not run yet",
      next: "2026-09-28T15:05:00.000Z",
    });
  });

  test("Then the schedule is the one configured, in words, not a constant", () => {
    expect(scheduledRunRows([unrun(CHICAGO_DAILY)], (t) => t)[0].schedule).toBe(
      "Daily at 02:00, America/Chicago",
    );
    expect(scheduledRunRows([unrun(OFF)], (t) => t)[0].schedule).toBe("Off");
    expect(scheduledRunRows([], (t) => t)[0].schedule).toBe("Not known.");
  });
});

describe("Given the band's one line about the price publish", () => {
  const now = new Date("2026-09-28T14:40:00Z");

  test("Then the next run is the schedule's next moment: by default the next five past the hour, in UTC", () => {
    expect(nextPublish(now, HOURLY).toISOString()).toBe(
      "2026-09-28T15:05:00.000Z",
    );
    expect(
      nextPublish(new Date("2026-09-28T14:03:00Z"), HOURLY).toISOString(),
    ).toBe("2026-09-28T14:05:00.000Z");
    expect(
      nextPublish(new Date("2026-09-28T14:05:00Z"), HOURLY).toISOString(),
    ).toBe("2026-09-28T15:05:00.000Z");
    // Daily at 02:00 in Chicago is 07:00 UTC.
    expect(nextPublish(now, CHICAGO_DAILY).toISOString()).toBe(
      "2026-09-29T07:00:00.000Z",
    );
    expect(nextPublish(now, OFF)).toBeNull();
  });

  test("Then a publish switched off, or a schedule not known, has no next run", () => {
    expect(publishLine([unrun(OFF)], now, (t) => t).next).toBe("not scheduled");
    expect(publishLine([], now, (t) => t).next).toBe("not scheduled");
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
    expect(publishLine([unrun(HOURLY)], now, (t) => t).last).toBe(
      "has not run yet",
    );
    expect(
      publishLine(
        [run({ at: "T", error: "Contoso ERP answered 503" })],
        now,
        (t) => t,
      ).last,
    ).toBe("last ran T, failed, Contoso ERP answered 503");
  });
});
