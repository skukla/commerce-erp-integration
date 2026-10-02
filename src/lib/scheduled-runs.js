/*
 * The integration's scheduled runs, for the Admin page's Activity section: when each last ran
 * and what it changed, so an SC can show a prospect the schedule working. Scheduled work runs
 * from one App Builder alarm, a heartbeat every five minutes (ext.config.yaml, erp/scheduled),
 * not Commerce cron; each job's schedule is a setting (lib/schedule.js, AB-38).
 *
 * One record per job in App Builder State. Most hourly runs change nothing (a publish writes
 * only changes), so the last run that changed something is kept beside the last run. The
 * record also holds the scheduled moment the job last ran for (`lastMoment`), claimed before
 * the job runs, so a tick that repeats or overlaps does not run it twice for one moment.
 * Recording never breaks the run it records: a storage failure is swallowed.
 */
import stateLib from "@adobe/aio-lib-state";

import { SCHEDULED_JOBS } from "#lib/schedule";
import { releaseLock, takeLock } from "#lib/state-lock";

const PREFIX = "scheduled.";
const TTL_SECONDS = 30 * 24 * 60 * 60;
/** The runs the integration schedules, in the order the page lists them. */
const RUNS = SCHEDULED_JOBS;
/** A tick does not wait for another tick holding a job: the moment is that tick's. */
const ONE_TRY = Object.freeze({ attempts: 1, wait: () => Promise.resolve() });

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
      ...(previous.lastMoment ? { lastMoment: previous.lastMoment } : {}),
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
 * Claim the scheduled moment a job is due for, before running it: the moment is written to
 * the job's record under a lock, so a second tick for the same moment, or one overlapping
 * this one, claims nothing. A job that then fails keeps its claim and is due again at its next
 * moment, not on every tick.
 * @param {string} id the job (`prices`)
 * @param {(after: string|undefined) => Date|null} dueFor the moment due, given the moment
 *   the job last ran for (or, for a run recorded before moments were, when it ran)
 * @returns {Promise<Date|null>} the moment claimed, or null when nothing is due or another
 *   tick holds the job
 * @throws when State cannot be read or written: an unrecorded run could run every tick
 */
export async function claimDueMoment(id, dueFor) {
  if (!stateAvailable()) {
    return dueFor(undefined);
  }
  const client = await state();
  const lockKey = `${PREFIX}${id}.lock`;
  const token = await takeLock(client, lockKey, ONE_TRY);
  if (!token) {
    return null;
  }
  try {
    const found = await client.get(`${PREFIX}${id}`);
    const record = found?.value ? JSON.parse(found.value) : { id };
    const moment = dueFor(record.lastMoment ?? record.lastRun?.at);
    if (!moment) {
      return null;
    }
    const claimed = { ...record, id, lastMoment: moment.toISOString() };
    await client.put(`${PREFIX}${id}`, JSON.stringify(claimed), {
      ttl: TTL_SECONDS,
    });
    return moment;
  } finally {
    await releaseLock(client, lockKey, token);
  }
}

/**
 * Forget what the page shows of every run, its last run and last change (a demo reset starts
 * the page again, AB-16n), and keep the scheduled moment each job last ran for. A record
 * deleted outright reads as "never ran", so the next heartbeat would run every job at once:
 * the reset would republish prices from ERPs it is about to wipe. With its moment kept, a job
 * is next due at its next scheduled moment. A run recorded before moments were keeps when it
 * ran; a record with neither is deleted.
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
    if (!found?.value) {
      continue;
    }
    const record = JSON.parse(found.value);
    const lastMoment = record.lastMoment ?? record.lastRun?.at;
    if (lastMoment) {
      await client.put(`${PREFIX}${id}`, JSON.stringify({ id, lastMoment }), {
        ttl: TTL_SECONDS,
      });
    } else {
      await client.delete(`${PREFIX}${id}`);
    }
    cleared += 1;
  }
  return cleared;
}

/**
 * @returns {Promise<object[]>} each job with a record, `{ id, lastRun, lastChange, lastMoment }`;
 *   one claimed and not yet run, or cleared by a reset, has no `lastRun`
 */
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
