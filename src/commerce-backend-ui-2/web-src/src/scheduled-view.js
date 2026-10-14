/*
 * What the page says about the integration's scheduled runs (erp/history?scheduled=true,
 * lib/scheduled-runs.js), kept apart from the React that renders it (as history-view.js is): the
 * Overview's Price publish block and the side panel's table. Each run carries its schedule as the settings set
 * it (AB-38), so the words and the next run follow the settings, read the way the heartbeat
 * reads them (lib/schedule.js).
 */
import { nextMoment, scheduleWords } from "#lib/schedule";

/** Each run the integration schedules, as the page names it. */
const RUNS = [
  {
    id: "prices",
    title: "Price publish: each ERP's prices in force into the shared catalogs",
  },
];

/** What a run moved: "3 written, 1 removed", or none. */
function moved(run) {
  return [
    run.written > 0 ? `${run.written} written` : null,
    run.removed > 0 ? `${run.removed} removed` : null,
  ].filter(Boolean);
}

/**
 * A run in words: "14 prices checked, none changed", "124 prices checked, 3 written, 1
 * removed", and what it could not publish. It read "nothing changed, 14 unchanged" until
 * 2026-10-14, which says nothing twice.
 */
function runWords(run) {
  if (run.error) {
    return `failed: ${run.error}`;
  }
  const checked = run.written + run.removed + run.unchanged;
  const changed = moved(run);
  const words = [
    `${checked} ${checked === 1 ? "price" : "prices"} checked`,
    changed.length > 0 ? changed.join(", ") : "none changed",
  ];
  if (run.failed > 0) {
    words.push(`${run.failed} not published`);
  }
  return words.join(", ");
}

/**
 * @param {object[]} runs erp/history?scheduled=true's `scheduled`
 * @param {(iso: string) => string} when how the page writes a time
 * @returns {object[]} one row per scheduled run, listed whether or not it has run
 */
export function scheduledRunRows(runs, when) {
  return RUNS.map((known) => {
    const run = runs.find((r) => r.id === known.id);
    return {
      ...known,
      lastChange: run?.lastChange
        ? `${when(run.lastChange.at)}, ${moved(run.lastChange).join(", ")}`
        : "No change yet",
      lastRun: run?.lastRun
        ? `${when(run.lastRun.at)}, ${runWords(run.lastRun)}`
        : "Has not run yet",
      schedule: run?.schedule ? scheduleWords(run.schedule) : "Not known.",
    };
  });
}

/**
 * When the price publish next runs, by its schedule.
 * @param {Date} now
 * @param {object} schedule the run's schedule (erp/history?scheduled=true)
 * @returns {Date|null} null when it is off
 */
export function nextPublish(now, schedule) {
  return nextMoment(schedule, now);
}

/**
 * When the price publish next runs, in the page's words.
 * @param {object[]} runs erp/history?scheduled=true's `scheduled`
 * @param {Date} now
 * @param {(iso: string) => string} when how the page writes a time
 * @returns {string} the time, or "not scheduled"
 */
export function nextPublishText(runs, now, when) {
  const prices = runs.find((r) => r.id === "prices");
  const next = prices?.schedule ? nextPublish(now, prices.schedule) : null;
  return next ? when(next.toISOString()) : "not scheduled";
}
