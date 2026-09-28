/*
 * The integration's scheduled runs, for the Admin page's Activity section: when each last ran
 * and what it changed, so an SC can show a prospect the schedule working. Scheduled work runs
 * as App Builder alarms (ext.config.yaml triggers), not Commerce cron.
 *
 * One record per run in App Builder State. Most hourly runs change nothing (a publish writes
 * only changes), so the last run that changed something is kept beside the last run.
 * Recording never breaks the run it records: a storage failure is swallowed.
 */
import stateLib from "@adobe/aio-lib-state";

const PREFIX = "scheduled.";
const TTL_SECONDS = 30 * 24 * 60 * 60;
/** The runs the integration schedules, in the order the page lists them. */
const RUNS = Object.freeze(["prices"]);

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetScheduledRunsClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

/** Whether State can be reached here: on Runtime, or with a client handed in. */
function stateAvailable() {
  return Boolean(statePromise) || Boolean(process.env.__OW_NAMESPACE);
}

/** A publish's figures (lib/publish-prices.js), or why the run failed. */
function figuresOf(result, at) {
  if (result.error) {
    return { at, error: String(result.error) };
  }
  return {
    at,
    failed: result.failed?.length ?? 0,
    removed: result.removed ?? 0,
    unchanged: result.unchanged ?? 0,
    written: result.written ?? 0,
  };
}

/**
 * Record one run.
 * @param {string} id the run (`prices`)
 * @param {object} result what the run answered, or `{ error }` when it failed
 * @param {string} [at] when it ran (ISO 8601)
 * @returns {Promise<void>}
 */
export async function recordScheduledRun(
  id,
  result,
  at = new Date().toISOString(),
) {
  if (!stateAvailable()) {
    return;
  }
  try {
    const client = await state();
    const before = await client.get(`${PREFIX}${id}`);
    const previous = before?.value ? JSON.parse(before.value) : {};
    const lastRun = figuresOf(result, at);
    const changed = lastRun.written + lastRun.removed > 0;
    const record = {
      id,
      lastChange: changed ? lastRun : (previous.lastChange ?? null),
      lastRun,
    };
    await client.put(`${PREFIX}${id}`, JSON.stringify(record), {
      ttl: TTL_SECONDS,
    });
  } catch {
    // Recording must not break the run it records.
  }
}

/**
 * Forget every run's record (a demo reset starts the page again, AB-16n); the next run fills it.
 * @returns {Promise<number>} how many records there were
 */
export async function clearScheduledRuns() {
  if (!stateAvailable()) {
    return 0;
  }
  const client = await state();
  let cleared = 0;
  for (const id of RUNS) {
    // biome-ignore lint/performance/noAwaitInLoops: one run, few runs
    const found = await client.get(`${PREFIX}${id}`);
    if (found?.value) {
      await client.delete(`${PREFIX}${id}`);
      cleared += 1;
    }
  }
  return cleared;
}

/** @returns {Promise<object[]>} each run that has run, `{ id, lastRun, lastChange }` */
export async function readScheduledRuns() {
  if (!stateAvailable()) {
    return [];
  }
  const client = await state();
  const found = await Promise.all(
    RUNS.map((id) => client.get(`${PREFIX}${id}`)),
  );
  return found.filter((res) => res?.value).map((res) => JSON.parse(res.value));
}
