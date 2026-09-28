/*
 * The integration's scheduled runs, for the Admin page's Activity section (AB-16c, owner
 * 2026-09-28): an SC shows a prospect the schedule working, when each run last ran and what it
 * changed. Scheduled work runs as App Builder alarms, not Commerce cron. Most hourly runs
 * change nothing, so the last run that changed something is kept beside the last run.
 */
import {
  readScheduledRuns,
  recordScheduledRun,
  resetScheduledRunsClient,
} from "#lib/scheduled-runs";

import { fakeState } from "../box/state.js";

const WROTE = {
  failed: [],
  removed: 0,
  skipped: [],
  unchanged: 120,
  written: 3,
};
const NOTHING = {
  failed: [],
  removed: 0,
  skipped: [],
  unchanged: 123,
  written: 0,
};

beforeEach(() => resetScheduledRunsClient(fakeState()));
afterEach(() => resetScheduledRunsClient());

describe("Given the hourly price publish", () => {
  test("Then nothing is listed before it first runs", async () => {
    expect(await readScheduledRuns()).toEqual([]);
  });

  test("Then a run that changed prices is its last run and its last change", async () => {
    await recordScheduledRun("prices", WROTE, "2026-09-28T14:05:00.000Z");
    expect(await readScheduledRuns()).toEqual([
      {
        id: "prices",
        lastChange: {
          at: "2026-09-28T14:05:00.000Z",
          failed: 0,
          removed: 0,
          unchanged: 120,
          written: 3,
        },
        lastRun: {
          at: "2026-09-28T14:05:00.000Z",
          failed: 0,
          removed: 0,
          unchanged: 120,
          written: 3,
        },
      },
    ]);
  });

  test("Then a later run that changed nothing keeps the last change beside it", async () => {
    await recordScheduledRun("prices", WROTE, "2026-09-28T14:05:00.000Z");
    await recordScheduledRun("prices", NOTHING, "2026-09-28T15:05:00.000Z");
    const [run] = await readScheduledRuns();
    expect(run.lastRun.at).toBe("2026-09-28T15:05:00.000Z");
    expect(run.lastRun.written).toBe(0);
    expect(run.lastChange.at).toBe("2026-09-28T14:05:00.000Z");
  });

  test("Then a run that failed is recorded with why", async () => {
    await recordScheduledRun(
      "prices",
      { error: "state down" },
      "2026-09-28T16:05:00.000Z",
    );
    const [run] = await readScheduledRuns();
    expect(run.lastRun).toEqual({
      at: "2026-09-28T16:05:00.000Z",
      error: "state down",
    });
    expect(run.lastChange).toBeNull();
  });

  test("Then a record that cannot be written never breaks the run", async () => {
    resetScheduledRunsClient({
      get: () => Promise.reject(new Error("State is down")),
    });
    await expect(
      recordScheduledRun("prices", WROTE, "2026-09-28T14:05:00.000Z"),
    ).resolves.toBeUndefined();
  });
});
