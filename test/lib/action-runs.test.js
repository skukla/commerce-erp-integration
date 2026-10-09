/*
 * A run a caller can ask about afterwards. erp/detach and erp/prices are web actions: their
 * HTTP answer is cut off at 60 seconds while the action runs on to its own limit, so a caller
 * that names its run (`run`) finds how it went in State under that name and the action's kind:
 * running, done with the answer, or failed with why. The detach assertions below are the ones
 * the record kept when it was detach's alone (AB-61): its key and records
 * are unchanged, so a detach run stored before this still reads.
 */
// biome-ignore-all lint/suspicious/useAwait: the fakes answer promises without waiting on anything; the real collaborators are async and the run awaits them
import {
  readRun,
  resetRunsClient,
  runKey,
  runProblem,
  trackRun,
} from "#lib/action-runs";

import { fakeState } from "../box/state.js";

const RUN = "reset-2026-10-02_a1";
const KEY = "detach-run-reset-2026-10-02_a1";
const STARTED = "2026-10-02T11:44:00.000Z";
const FINISHED = "2026-10-02T11:45:05.000Z";
const DAY_SECONDS = 86_400;
const RESULT = {
  holds: { failed: [], released: 0 },
  orders: { cleared: 2, failed: [] },
  reverted: { failed: [], reverted: 103 },
};

/** A clock answering the given times in turn. */
const clock = (...times) => {
  const left = [...times];
  return () => left.shift();
};

let state;
beforeEach(() => {
  state = fakeState();
  vi.spyOn(state, "put");
  resetRunsClient(state);
});
afterEach(() => resetRunsClient());

describe("Given the id a caller names its detach run by", () => {
  test.each([
    ["12345678"],
    ["a".repeat(64)],
    ["Reset_2026-10-02"],
    ["3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b"],
  ])("Then %s is taken", (run) => {
    expect(runProblem(run)).toBeNull();
  });

  test.each([
    ["1234567"],
    ["a".repeat(65)],
    ["has a space"],
    ["../erps-list"],
    ["dots.are.out"],
    [""],
  ])("Then %j is refused in words", (run) => {
    expect(runProblem(run)).toBe(
      "run is an id of 8 to 64 letters, digits, hyphens and underscores",
    );
  });

  test("Then its record's key carries it, under detach's prefix as before", () => {
    expect(runKey("detach", RUN)).toBe(KEY);
  });

  test("Then a price publish's record has its own key, so the two kinds never read each other's", () => {
    expect(runKey("prices", RUN)).toBe("prices-run-reset-2026-10-02_a1");
  });

  test("Then a kind nothing tracks is refused in words", () => {
    expect(() => runKey("wipe", RUN)).toThrow(
      "wipe is not a kind of run; the kinds are detach, prices",
    );
  });
});

describe("Given a detach run under a caller's id", () => {
  test("Then it is recorded as running before any work, kept for one day", async () => {
    let during;
    const work = vi.fn(async () => {
      during = await readRun("detach", RUN);
      return RESULT;
    });

    await trackRun("detach", RUN, work, clock(STARTED, FINISHED));

    expect(during).toEqual({ run: RUN, startedAt: STARTED, status: "running" });
    expect(state.put.mock.calls[0]).toEqual([
      KEY,
      JSON.stringify({ run: RUN, startedAt: STARTED, status: "running" }),
      { ttl: DAY_SECONDS },
    ]);
  });

  test("Then once it returns it is done, with what the detach answered", async () => {
    const answered = await trackRun(
      "detach",
      RUN,
      async () => RESULT,
      clock(STARTED, FINISHED),
    );

    expect(answered).toBe(RESULT);
    expect(await readRun("detach", RUN)).toEqual({
      finishedAt: FINISHED,
      result: RESULT,
      run: RUN,
      startedAt: STARTED,
      status: "done",
    });
    expect(state.put.mock.calls[1][0]).toBe(KEY);
    expect(state.put.mock.calls[1][2]).toEqual({ ttl: DAY_SECONDS });
  });

  test("Then when it throws it is failed, with why, and the error still reaches the caller", async () => {
    const work = async () => {
      throw new Error("Commerce answered 503");
    };

    await expect(
      trackRun("detach", RUN, work, clock(STARTED, FINISHED)),
    ).rejects.toThrow("Commerce answered 503");

    expect(await readRun("detach", RUN)).toEqual({
      error: "Commerce answered 503",
      finishedAt: FINISHED,
      run: RUN,
      startedAt: STARTED,
      status: "failed",
    });
  });

  test("Then a run that cannot be recorded as started does no work: nobody could ask about it", async () => {
    resetRunsClient({
      put: () => Promise.reject(new Error("State is down")),
    });
    const work = vi.fn(async () => RESULT);

    await expect(trackRun("detach", RUN, work)).rejects.toThrow(
      "State is down",
    );

    expect(work).not.toHaveBeenCalled();
  });

  test("Then an outcome that cannot be recorded never changes what the detach answered", async () => {
    const work = async () => {
      state.put.mockRejectedValue(new Error("State is down"));
      return RESULT;
    };

    expect(await trackRun("detach", RUN, work)).toBe(RESULT);
  });

  test("Then a failure that cannot be recorded still reaches the caller as the detach's own error", async () => {
    const work = async () => {
      state.put.mockRejectedValue(new Error("State is down"));
      throw new Error("Commerce answered 503");
    };

    await expect(trackRun("detach", RUN, work)).rejects.toThrow(
      "Commerce answered 503",
    );
  });
});

describe("Given a caller asking how a run went", () => {
  test("Then a run nobody started has no record", async () => {
    expect(await readRun("detach", "never-started")).toBeNull();
  });

  test("Then a price publish's run is recorded and read under its own kind, apart from a detach's", async () => {
    await trackRun("prices", RUN, async () => RESULT, clock(STARTED, FINISHED));

    expect(await readRun("prices", RUN)).toMatchObject({
      result: RESULT,
      status: "done",
    });
    expect(await readRun("detach", RUN)).toBeNull();
    expect(state.put.mock.calls[0][0]).toBe("prices-run-reset-2026-10-02_a1");
  });
});
