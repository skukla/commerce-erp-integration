/*
 * The integration's scheduled runs, for the Admin page's Activity section (AB-16c, owner
 * 2026-09-28): an SC shows a prospect the schedule working, when each run last ran and what it
 * changed. Scheduled work runs as App Builder alarms, not Commerce cron. Most hourly runs
 * change nothing, so the last run that changed something is kept beside the last run.
 */
import { dueMoment } from "#lib/schedule";
import {
  claimDueMoment,
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

/*
 * The heartbeat (AB-38) claims a job's scheduled moment before it runs it, in the same record,
 * so a tick that repeats or overlaps does not run the job twice for one moment, and a run that
 * fails is tried again at the next moment, not on every tick.
 */
describe("Given a heartbeat tick claiming a job's scheduled moment", () => {
  const HOURLY = {
    enabled: true,
    frequency: "hourly",
    minute: 5,
    time: "02:00",
    timeZone: "UTC",
    weekday: "monday",
  };
  const now = new Date("2026-09-28T14:10:00Z");
  const dueNow = (after) => dueMoment(HOURLY, after, now);

  test("Then the first tick claims the moment and a repeated tick claims nothing", async () => {
    const dueFor = vi.fn(dueNow);
    const first = await claimDueMoment("prices", dueFor);
    const second = await claimDueMoment("prices", dueFor);
    expect(first?.toISOString()).toBe("2026-09-28T14:05:00.000Z");
    expect(second).toBeNull();
    expect(dueFor.mock.calls).toEqual([
      [undefined],
      ["2026-09-28T14:05:00.000Z"],
    ]);
    const [run] = await readScheduledRuns();
    expect(run).toMatchObject({
      id: "prices",
      lastMoment: "2026-09-28T14:05:00.000Z",
    });
  });

  test("Then a run recorded before moments were is read by when it ran", async () => {
    await recordScheduledRun("prices", WROTE, "2026-09-28T14:05:12.000Z");
    const dueFor = vi.fn(dueNow);
    expect(await claimDueMoment("prices", dueFor)).toBeNull();
    expect(dueFor).toHaveBeenCalledExactlyOnceWith("2026-09-28T14:05:12.000Z");
  });

  test("Then the run's record keeps the moment, and a failed run is not claimed again for it", async () => {
    await claimDueMoment("prices", dueNow);
    await recordScheduledRun(
      "prices",
      { error: "Contoso ERP answered 503" },
      "2026-09-28T14:10:02.000Z",
    );
    expect(await claimDueMoment("prices", dueNow)).toBeNull();
    const [run] = await readScheduledRuns();
    expect(run.lastMoment).toBe("2026-09-28T14:05:00.000Z");
    expect(run.lastRun.error).toBe("Contoso ERP answered 503");
    const later = (after) =>
      dueMoment(HOURLY, after, new Date("2026-09-28T15:05:00Z"));
    expect((await claimDueMoment("prices", later))?.toISOString()).toBe(
      "2026-09-28T15:05:00.000Z",
    );
  });

  test("Then a tick that finds another tick holding the job claims nothing", async () => {
    const state = fakeState();
    resetScheduledRunsClient(state);
    await state.put(
      "scheduled.prices.lock",
      JSON.stringify({ token: "other", until: Date.now() + 30_000 }),
    );
    const dueFor = vi.fn(dueNow);
    expect(await claimDueMoment("prices", dueFor)).toBeNull();
    expect(dueFor).not.toHaveBeenCalled();
  });

  test("Then State that cannot be read is an error, so the job does not run unrecorded", async () => {
    resetScheduledRunsClient({
      get: () => Promise.reject(new Error("State is down")),
    });
    await expect(claimDueMoment("prices", dueNow)).rejects.toThrow(
      "State is down",
    );
  });
});
