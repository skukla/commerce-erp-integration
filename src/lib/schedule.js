/*
 * When the integration's scheduled jobs run (AB-38, owner 2026-09-28: a business user edits
 * the schedules). Each job's schedule is a business setting (app.commerce.config.ts
 * `schedule_*`): on or off, hourly at a minute, daily at a time, or weekly on a weekday at a
 * time, all in the store's timezone. One heartbeat alarm ticks every five minutes
 * (erp/scheduled) and runs whatever is due here.
 *
 * Due: the job's most recent scheduled moment is not in the future and is after the moment it
 * last ran for. A tick that repeats finds that moment already run for; a heartbeat that was
 * down finds only the latest moment, so a job runs once, not once per moment it missed.
 *
 * Pure: no State, no settings read, no clock of its own, so the Admin page can say the same
 * schedule in words and when it next runs. Timezones are the runtime's own (Intl).
 */

/** The jobs the heartbeat runs, in the order the page lists them. */
export const SCHEDULED_JOBS = Object.freeze(["prices"]);

const WEEKDAYS = Object.freeze([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MINUTES_PER_HOUR = 60;
/** A week either side of today holds the latest and the next moment of any schedule. */
const DAYS_AROUND = 8;
const FALLBACK_ZONE = "UTC";

/**
 * Whether the runtime knows this timezone (an IANA name, as America/Chicago, or UTC).
 * @param {unknown} name
 */
export function isTimeZone(name) {
  if (typeof name !== "string" || name === "") {
    return false;
  }
  try {
    return Boolean(
      new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions()
        .timeZone,
    );
  } catch {
    return false;
  }
}

/**
 * One job's schedule, from the settings in force (lib/settings.js settingsFor).
 * @param {Record<string, unknown>} settings
 * @param {string} id the job (`prices`)
 * @returns {{ enabled: boolean, frequency: string, minute: number, time: string,
 *   weekday: string, timeZone: string }}
 */
export function scheduleOf(settings, id) {
  const zone = settings.schedule_timezone;
  return {
    enabled: settings[`schedule_${id}_enabled`] === true,
    frequency: String(settings[`schedule_${id}_frequency`]),
    minute: Number(settings[`schedule_${id}_minute`]),
    time: String(settings[`schedule_${id}_time`]),
    timeZone: isTimeZone(zone) ? zone : FALLBACK_ZONE,
    weekday: String(settings[`schedule_${id}_weekday`]),
  };
}

const formatters = new Map();

/** A moment's wall-clock fields in a timezone. */
function wallClock(timeZone, date) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        hour: "numeric",
        hourCycle: "h23",
        minute: "numeric",
        month: "numeric",
        second: "numeric",
        timeZone,
        year: "numeric",
      }),
    );
  }
  const parts = formatters.get(timeZone).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

/** How far the timezone's wall clock is ahead of UTC at a moment, in ms. */
function offsetAt(timeZone, ms) {
  const w = wallClock(timeZone, new Date(ms));
  const wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wall - (ms - (ms % 1000));
}

/**
 * The moment a wall-clock time happens in a timezone. A time the clocks pass twice is the
 * first; a time they skip is read with the offset before the change, so it lands just after.
 */
function momentOf(timeZone, wall) {
  const before = offsetAt(timeZone, wall - DAY_MS);
  const after = offsetAt(timeZone, wall + DAY_MS);
  const fits = [wall - before, wall - after].filter(
    (ms) => ms + offsetAt(timeZone, ms) === wall,
  );
  return fits.length > 0 ? Math.min(...fits) : wall - before;
}

/** Every daily or weekly moment within a week either side of now. */
function momentsAround(schedule, now) {
  const today = wallClock(schedule.timeZone, now);
  const [hour, minute] = schedule.time.split(":").map(Number);
  const moments = [];
  for (let k = -DAYS_AROUND; k <= DAYS_AROUND; k += 1) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + k));
    const weekday = WEEKDAYS[day.getUTCDay()];
    if (schedule.frequency === "weekly" && weekday !== schedule.weekday) {
      continue;
    }
    const wall = Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hour,
      minute,
    );
    moments.push(momentOf(schedule.timeZone, wall));
  }
  return moments;
}

/** The hourly moment at or before now: the store's minute, in the hour now is in. */
function latestHourly(schedule, now) {
  const floor = now.getTime() - (now.getTime() % MINUTE_MS);
  const local = wallClock(schedule.timeZone, now).minute;
  const back = (local - schedule.minute + MINUTES_PER_HOUR) % MINUTES_PER_HOUR;
  return floor - back * MINUTE_MS;
}

/**
 * The job's most recent scheduled moment at or before now, or null when it is off.
 * @param {ReturnType<typeof scheduleOf>} schedule
 * @param {Date} now
 * @returns {Date|null}
 */
export function latestMoment(schedule, now) {
  if (!schedule.enabled) {
    return null;
  }
  if (schedule.frequency === "hourly") {
    return new Date(latestHourly(schedule, now));
  }
  const past = momentsAround(schedule, now).filter((ms) => ms <= now.getTime());
  return past.length > 0 ? new Date(Math.max(...past)) : null;
}

/**
 * The job's first scheduled moment after now, or null when it is off.
 * @param {ReturnType<typeof scheduleOf>} schedule
 * @param {Date} now
 * @returns {Date|null}
 */
export function nextMoment(schedule, now) {
  if (!schedule.enabled) {
    return null;
  }
  if (schedule.frequency === "hourly") {
    return new Date(latestHourly(schedule, now) + HOUR_MS);
  }
  const ahead = momentsAround(schedule, now).filter((ms) => ms > now.getTime());
  return ahead.length > 0 ? new Date(Math.min(...ahead)) : null;
}

/**
 * The moment to run the job for on this tick, or null when nothing is due.
 * @param {ReturnType<typeof scheduleOf>} schedule
 * @param {string|undefined} after the moment it last ran for (or, for a run recorded before
 *   moments were, when that run was), ISO 8601; undefined when it never ran
 * @param {Date} now
 * @returns {Date|null}
 */
export function dueMoment(schedule, after, now) {
  const latest = latestMoment(schedule, now);
  if (!latest) {
    return null;
  }
  if (after && latest.getTime() <= new Date(after).getTime()) {
    return null;
  }
  return latest;
}

const pad = (n) => String(n).padStart(2, "0");
const capitalized = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The schedule as the page says it: "Every hour at :05, store time (UTC)", "Daily at 02:00,
 * America/Chicago", "Weekly on Monday at 02:00, UTC", "Off".
 * @param {ReturnType<typeof scheduleOf>} schedule
 */
export function scheduleWords(schedule) {
  if (!schedule.enabled) {
    return "Off";
  }
  if (schedule.frequency === "hourly") {
    return `Every hour at :${pad(schedule.minute)}, store time (${schedule.timeZone})`;
  }
  if (schedule.frequency === "weekly") {
    return `Weekly on ${capitalized(schedule.weekday)} at ${schedule.time}, ${schedule.timeZone}`;
  }
  return `Daily at ${schedule.time}, ${schedule.timeZone}`;
}

/**
 * Every job with its schedule, whether or not it has run (erp/history?scheduled=true).
 * @param {object[]} runs lib/scheduled-runs.js readScheduledRuns
 * @param {Record<string, unknown>} settings the settings in force
 */
export function jobsWithSchedules(runs, settings) {
  return SCHEDULED_JOBS.map((id) => ({
    ...(runs.find((run) => run.id === id) ?? { id }),
    schedule: scheduleOf(settings, id),
  }));
}
