/*
 * A run a caller can ask about afterwards. erp/detach and erp/prices are web actions, so their
 * HTTP answer is cut off at 60 seconds ("Response not yet ready") while the action itself runs
 * on to its own limit: a caller that waited for the answer saw a failure where the work then
 * finished (a detach of about 65 seconds, measured live 2026-10-02; a price publish after an
 * ERP reset, 2026-10-09). A caller that names its run finds how it went here instead.
 *
 * One record per named run and kind in App Builder State, `<kind>-run-<run>`, kept for a day:
 * `{ run, status: "running", startedAt }` from before any work, then
 * `{ run, status: "done", startedAt, finishedAt, result }` with what the action answered, or
 * `{ run, status: "failed", startedAt, finishedAt, error }` with why it threw. A detach's key
 * is `detach-run-<run>`, as it was when the record was detach's alone (AB-61), so a run stored
 * before a price publish could be tracked still reads.
 */
import stateLib from "@adobe/aio-lib-state";

/** The actions whose runs are tracked, each the prefix of its own records. */
const KINDS = ["detach", "prices"];
const TTL_SECONDS = 24 * 60 * 60;
/** A caller-chosen id; every character is one a State key takes. */
const RUN_ID = /^[A-Za-z0-9_-]{8,64}$/u;

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetRunsClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

/**
 * The State key of a run's record.
 * @param {"detach"|"prices"} kind the action that ran
 * @param {string} run the caller's id
 */
export function runKey(kind, run) {
  if (!KINDS.includes(kind)) {
    throw new Error(
      `${kind} is not a kind of run; the kinds are ${KINDS.join(", ")}`,
    );
  }
  return `${kind}-run-${run}`;
}

/**
 * @param {unknown} run the id a caller named its run by
 * @returns {string|null} why it cannot be one, or null when it can
 */
export function runProblem(run) {
  return RUN_ID.test(String(run))
    ? null
    : "run is an id of 8 to 64 letters, digits, hyphens and underscores";
}

async function write(kind, record) {
  const client = await state();
  await client.put(runKey(kind, record.run), JSON.stringify(record), {
    ttl: TTL_SECONDS,
  });
}

/** The outcome is recorded when it can be; the action's own answer never depends on it. */
async function writeOutcome(kind, record) {
  try {
    await write(kind, record);
  } catch {
    // The work has run: a record that cannot be written must not turn its answer into a failure.
  }
}

/**
 * Run an action's work under a caller's id, recording it as running before any work and as
 * done or failed after. A run that cannot be recorded as started does no work and throws:
 * nobody could ask about it.
 * @template T
 * @param {"detach"|"prices"} kind the action that runs
 * @param {string} run the caller's id (see `runProblem`)
 * @param {() => Promise<T>} work the action's work
 * @param {() => string} [now] the time, ISO 8601
 * @returns {Promise<T>} what the work answered
 * @throws what the work threw
 */
export async function trackRun(
  kind,
  run,
  work,
  now = () => new Date().toISOString(),
) {
  const started = { run, startedAt: now() };
  await write(kind, { ...started, status: "running" });
  let result;
  try {
    result = await work();
  } catch (error) {
    await writeOutcome(kind, {
      ...started,
      error: error.message,
      finishedAt: now(),
      status: "failed",
    });
    throw error;
  }
  await writeOutcome(kind, {
    ...started,
    finishedAt: now(),
    result,
    status: "done",
  });
  return result;
}

/**
 * @param {"detach"|"prices"} kind the action that ran
 * @param {string} run the caller's id
 * @returns {Promise<object|null>} the run's record, or null when no run of that kind was
 *   started by that id (or its record is older than a day)
 */
export async function readRun(kind, run) {
  const found = await (await state()).get(runKey(kind, run));
  return found?.value ? JSON.parse(found.value) : null;
}
