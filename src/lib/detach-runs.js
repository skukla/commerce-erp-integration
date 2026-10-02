/*
 * A detach a caller can ask about afterwards. erp/detach is a web action, so its HTTP answer
 * is cut off at 60 seconds ("Response not yet ready") while the action itself runs on to its
 * own limit: a caller that waited for the answer saw a failure where the detach then finished
 * (measured live 2026-10-02, a detach of about 65 seconds). A caller that names its run finds
 * how it went here instead.
 *
 * One record per named run in App Builder State, `detach-run-<run>`, kept for a day:
 * `{ run, status: "running", startedAt }` from before any work, then
 * `{ run, status: "done", startedAt, finishedAt, result }` with what the detach answered, or
 * `{ run, status: "failed", startedAt, finishedAt, error }` with why it threw.
 */
import stateLib from "@adobe/aio-lib-state";

const PREFIX = "detach-run-";
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
export function resetDetachRunsClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

/** The State key of a run's record. */
export function detachRunKey(run) {
  return `${PREFIX}${run}`;
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

async function write(record) {
  const client = await state();
  await client.put(detachRunKey(record.run), JSON.stringify(record), {
    ttl: TTL_SECONDS,
  });
}

/** The outcome is recorded when it can be; the detach's own answer never depends on it. */
async function writeOutcome(record) {
  try {
    await write(record);
  } catch {
    // The detach has run: a record that cannot be written must not turn its answer into a failure.
  }
}

/**
 * Run a detach under a caller's id, recording it as running before any work and as done or
 * failed after. A run that cannot be recorded as started does no work and throws: nobody could
 * ask about it.
 * @template T
 * @param {string} run the caller's id (see `runProblem`)
 * @param {() => Promise<T>} work the detach
 * @param {() => string} [now] the time, ISO 8601
 * @returns {Promise<T>} what the detach answered
 * @throws what the detach threw
 */
export async function trackDetachRun(
  run,
  work,
  now = () => new Date().toISOString(),
) {
  const started = { run, startedAt: now() };
  await write({ ...started, status: "running" });
  let result;
  try {
    result = await work();
  } catch (error) {
    await writeOutcome({
      ...started,
      error: error.message,
      finishedAt: now(),
      status: "failed",
    });
    throw error;
  }
  await writeOutcome({
    ...started,
    finishedAt: now(),
    result,
    status: "done",
  });
  return result;
}

/**
 * @param {string} run the caller's id
 * @returns {Promise<object|null>} the run's record, or null when no run was started by that id
 *   (or its record is older than a day)
 */
export async function readDetachRun(run) {
  const found = await (await state()).get(detachRunKey(run));
  return found?.value ? JSON.parse(found.value) : null;
}
