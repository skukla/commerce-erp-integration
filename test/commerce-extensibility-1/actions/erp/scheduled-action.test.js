/*
 * erp/scheduled: the heartbeat (AB-38). One App Builder alarm starts it every five minutes
 * (ext.config.yaml); it reads each job's schedule from the settings at Default Config and runs
 * the jobs that are due (lib/schedule.js). The only job today is the price publish: the ERP
 * raises no event when a price line's start or end date arrives, so this run is what makes the
 * date take effect, and every ERP's prices in force are published again, as erp/prices does.
 * The trigger carries no Adobe sign-in and no HTTP method; the handler is tested, not the
 * trigger.
 */
import { existsSync, readFileSync } from "node:fs";

vi.mock("#lib/erp", () => ({ erp: { inForce: vi.fn() } }));
vi.mock("#lib/erps", async (importOriginal) => ({
  ...(await importOriginal()),
  loadErps: vi.fn(),
}));
vi.mock("#lib/contract-prices", async (importOriginal) => ({
  ...(await importOriginal()),
  publishErpPrices: vi.fn(),
}));
vi.mock("#lib/settings", () => ({ settingsFor: vi.fn() }));

import { publishErpPrices } from "#lib/contract-prices";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import {
  readScheduledRuns,
  resetScheduledRunsClient,
} from "#lib/scheduled-runs";
import { settingsFor } from "#lib/settings";
import { main } from "#src/erp/scheduled/index";

import { fakeState } from "../../../box/state.js";

/** The declared defaults (app.commerce.config.ts): the alarm this heartbeat replaced. */
const DEFAULTS = {
  schedule_prices_enabled: true,
  schedule_prices_frequency: "hourly",
  schedule_prices_minute: "5",
  schedule_prices_time: "02:00",
  schedule_prices_weekday: "monday",
  schedule_timezone: "UTC",
};

const ERP = (id, baseUrl) => ({
  adapter: "demo-erp",
  connection: { baseUrl },
  id,
  name: `${id} ERP`,
});

/** One heartbeat tick at a moment, with the trigger's payload. */
async function tickAt(isoTime) {
  vi.setSystemTime(new Date(isoTime));
  return await main({
    triggerName: "/ns/erp-schedule-heartbeat",
    type: "scheduled",
  });
}

const publishedErps = () => publishErpPrices.mock.calls.map((c) => c[1].id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  resetScheduledRunsClient(fakeState());
  settingsFor.mockResolvedValue({ ...DEFAULTS });
  loadErps.mockResolvedValue([
    ERP("acme", "https://a.example"),
    ERP("globex", "https://g.example"),
  ]);
  erp.inForce.mockResolvedValue({ data: { items: [] }, ok: true, status: 200 });
  publishErpPrices.mockResolvedValue({
    failed: [],
    removed: 1,
    skipped: [],
    unchanged: 2,
    written: 0,
  });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  resetScheduledRunsClient();
});

describe("Given the default schedule: the price publish every hour at :05, UTC", () => {
  test("Then the first tick after :05 publishes every ERP's prices in force, from the settings at Default Config", async () => {
    const res = await tickAt("2026-09-28T14:05:30Z");
    expect(res.statusCode).toBe(200);
    expect(settingsFor.mock.calls[0][0]).toBeNull();
    expect(erp.inForce.mock.calls.map(([p]) => p.ERP_BASE_URL)).toEqual([
      "https://a.example",
      "https://g.example",
    ]);
    expect(publishedErps()).toEqual(["acme", "globex"]);
    expect(res.body.jobs).toEqual([
      {
        id: "prices",
        moment: "2026-09-28T14:05:00.000Z",
        ran: true,
        result: expect.objectContaining({ removed: 2, unchanged: 4 }),
      },
    ]);
  });

  test("Then the next ticks in the same hour publish nothing, and the next :05 publishes again", async () => {
    await tickAt("2026-09-28T14:05:30Z");
    const quiet = await tickAt("2026-09-28T14:10:30Z");
    await tickAt("2026-09-28T14:10:31Z");
    expect(publishedErps()).toEqual(["acme", "globex"]);
    expect(quiet.body.jobs).toEqual([{ id: "prices", ran: false }]);
    await tickAt("2026-09-28T15:05:30Z");
    expect(publishedErps()).toEqual(["acme", "globex", "acme", "globex"]);
  });

  test("Then each run is recorded for the Admin page: its moment, when it ran and what it changed", async () => {
    await tickAt("2026-09-28T14:05:30Z");
    const [run] = await readScheduledRuns();
    expect(run).toMatchObject({
      id: "prices",
      lastChange: { at: "2026-09-28T14:05:30.000Z", removed: 2 },
      lastMoment: "2026-09-28T14:05:00.000Z",
      lastRun: { removed: 2, unchanged: 4, written: 0 },
    });
  });
});

describe("Given a schedule a business user changed", () => {
  test("Then a job switched off is never run", async () => {
    settingsFor.mockResolvedValue({
      ...DEFAULTS,
      schedule_prices_enabled: false,
    });
    const res = await tickAt("2026-09-28T14:05:30Z");
    expect(erp.inForce).not.toHaveBeenCalled();
    expect(res.body.jobs).toEqual([{ id: "prices", ran: false }]);
  });

  test("Then daily at 02:00 in Chicago runs at 02:00 there, 07:00 UTC, once", async () => {
    settingsFor.mockResolvedValue({
      ...DEFAULTS,
      schedule_prices_frequency: "daily",
      schedule_prices_time: "02:00",
      schedule_timezone: "America/Chicago",
    });
    // A first tick ever runs for the latest moment, yesterday's 02:00.
    await tickAt("2026-10-02T06:55:00Z");
    expect(publishedErps()).toEqual(["acme", "globex"]);
    await tickAt("2026-10-02T06:59:00Z");
    expect(publishedErps()).toHaveLength(2);
    const today = await tickAt("2026-10-02T07:00:10Z");
    expect(today.body.jobs[0].moment).toBe("2026-10-02T07:00:00.000Z");
    expect(publishedErps()).toHaveLength(4);
  });
});

describe("Given a run that fails", () => {
  test("Then it is recorded failed with why, answered as an error, and not tried again until its next moment", async () => {
    loadErps.mockRejectedValueOnce(new Error("state down"));
    const res = await tickAt("2026-09-28T14:05:30Z");
    expect(res.error.statusCode).toBe(500);
    const [run] = await readScheduledRuns();
    expect(run.lastRun.error).toBe("state down");
    await tickAt("2026-09-28T14:10:30Z");
    expect(loadErps).toHaveBeenCalledTimes(1);
    await tickAt("2026-09-28T15:05:30Z");
    expect(loadErps).toHaveBeenCalledTimes(2);
  });

  test("Then a job whose record cannot be read is not run, so it cannot run on every tick", async () => {
    resetScheduledRunsClient({
      get: () => Promise.reject(new Error("State is down")),
    });
    const res = await tickAt("2026-09-28T14:05:30Z");
    expect(loadErps).not.toHaveBeenCalled();
    expect(res.error.statusCode).toBe(500);
  });
});

const MAX_TRIGGERS_KEY = /^\s*maxTriggers:/mu;
const SCHEDULED_NOT_WEB =
  /\nscheduled:\n {2}function: \.\/scheduled\/index\.js\n {2}web: 'no'/u;

describe("Given the heartbeat as deployed", () => {
  // Read as text: the trigger itself is Runtime's, but a rule naming a missing action, a
  // web action a timer cannot call, or a maxTriggers that ends the schedule would fail
  // silently after deploy.
  test("Then one alarm every five minutes starts the non-web erp/scheduled, and the hourly price alarm is gone", () => {
    const ext = readFileSync(
      "src/commerce-extensibility-1/ext.config.yaml",
      "utf8",
    );
    expect(ext).toContain("feed: /whisk.system/alarms/alarm");
    expect(ext).toContain('cron: "*/5 * * * *"');
    expect(ext).toContain("trigger: erp-schedule-heartbeat");
    expect(ext).toContain("action: scheduled");
    expect(ext).not.toContain("erp-prices-hourly");
    expect(ext).not.toMatch(MAX_TRIGGERS_KEY);
    const actions = readFileSync(
      "src/commerce-extensibility-1/actions/erp/actions.config.yaml",
      "utf8",
    );
    expect(actions).toMatch(SCHEDULED_NOT_WEB);
    expect(actions).not.toContain("prices-scheduled");
    expect(
      existsSync("src/commerce-extensibility-1/actions/erp/prices-scheduled"),
    ).toBe(false);
  });
});
