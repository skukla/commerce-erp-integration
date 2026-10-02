/*
 * What the page says about the integration's scheduled runs (erp/history?scheduled=true,
 * lib/scheduled-runs.js), kept apart from the React that renders it (as history-view.js is): the
 * band's one line and the side panel's table. Each run carries its schedule as the settings set
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

/** A run's figures in words, with the unchanged count only when asked. */
function figures(run, withUnchanged) {
  if (run.error) {
    return `failed, ${run.error}.`;
  }
  const changed = [
    run.written > 0 ? `${run.written} written` : null,
    run.removed > 0 ? `${run.removed} removed` : null,
  ].filter(Boolean);
  const words = changed.length > 0 ? changed : ["nothing changed"];
  if (withUnchanged) {
    words.push(`${run.unchanged} unchanged`);
  }
  if (run.failed > 0) {
    words.push(`${run.failed} not published`);
  }
  return `${words.join(", ")}.`;
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
        ? `${when(run.lastChange.at)}: ${figures(run.lastChange, false)}`
        : "No change yet.",
      lastRun: run?.lastRun
        ? `${when(run.lastRun.at)}: ${figures(run.lastRun, true)}`
        : "Has not run yet.",
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
 * The band's one line: "Next price publish 3:05 PM · last ran 2:05 PM, nothing changed".
 * @param {object[]} runs erp/history?scheduled=true's `scheduled`
 * @param {Date} now
 * @param {(iso: string) => string} when how the page writes a time
 * @returns {{ next: string, last: string }}
 */
export function publishLine(runs, now, when) {
  const prices = runs.find((r) => r.id === "prices");
  const run = prices?.lastRun;
  const next = prices?.schedule ? nextPublish(now, prices.schedule) : null;
  return {
    last: run
      ? `last ran ${when(run.at)}, ${figures(run, false).replace(FULL_STOP, "")}`
      : "has not run yet",
    next: next ? when(next.toISOString()) : "not scheduled",
  };
}

const FULL_STOP = /\.$/u;
