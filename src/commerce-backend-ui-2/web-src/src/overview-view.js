/*
 * What the page says about each ERP, kept apart from the React that renders it (as
 * history-view.js is): the ERPs as one list whether there is one or several, each ERP's color,
 * the band's status line, the Overview's row for each ERP, and today's counts. Each listed ERP comes from
 * erp/status `erps` (several) or `erp` (one): its name, whether the integration can use it, why
 * not (a maintenance window, a refusal such as "the ERP answered 401", or a network error), its
 * figures, and how it looks (demo-erp's `appearance`).
 */
import { isProblem } from "#web/history-view.js";
import { ago, sameDay } from "#web/time-view.js";

const NONE = "–";
const ENDED = /[.!?]$/u;

/** The id the single ERP of an install has (src/lib/erps.js SINGLE_ERP_ID). */
export const SINGLE_ERP_ID = "erp";

/**
 * The ERP colors, from demo-erp's palettes (its lib/appearance.js `--accent` and
 * `--accent-tint`), so an ERP on this page and its own screen are the same color.
 */
export const PALETTES = Object.freeze({
  bronze: { color: "#8a5a1f", tint: "#f7efe3" },
  indigo: { color: "#3a4da8", tint: "#eaecf8" },
  plum: { color: "#7a3a6b", tint: "#f5eaf2" },
  slate: { color: "#47535f", tint: "#eceef0" },
  teal: { color: "#0f6b68", tint: "#e4f1f0" },
});
/** The order an ERP that does not say how it looks takes a color in. */
const PALETTE_ORDER = ["teal", "indigo", "bronze", "plum", "slate"];

/**
 * The ERPs as one list: with several, erp/status `erps`; with one, its health.
 * @param {object} status erp/status's answer
 * @returns {object[]} each `{ id, name, reachable, error?, counts?, lastImportAt?, lastWipeAt?,
 *   appearance? }`
 */
export function listedErps(status) {
  if ((status?.erps?.length ?? 0) > 1) {
    return status.erps;
  }
  const erp = status?.erp ?? {};
  return [
    {
      appearance: erp.appearance,
      counts: erp.counts,
      error: erp.error,
      id: status?.erps?.[0]?.id ?? SINGLE_ERP_ID,
      lastImportAt: erp.lastImportAt,
      lastWipeAt: erp.lastWipeAt,
      name: erp.displayName || status?.erps?.[0]?.name || "the ERP",
      reachable: Boolean(erp.reachable),
    },
  ];
}

/**
 * Each ERP's color: the palette it is dressed in when it says (demo-erp's health `appearance`)
 * and no ERP before it took that palette, else the next free palette in list order.
 * @param {object[]} erps the listed ERPs
 * @returns {Record<string, { color: string, tint: string, from: "erp"|"list" }>}
 */
export function erpColors(erps) {
  const taken = new Set();
  const chosen = {};
  for (const entry of erps) {
    const own = entry.appearance?.palette;
    if (PALETTES[own] && !taken.has(own)) {
      taken.add(own);
      chosen[entry.id] = { ...PALETTES[own], from: "erp" };
    }
  }
  for (const entry of erps) {
    if (chosen[entry.id]) {
      continue;
    }
    const free =
      PALETTE_ORDER.find((id) => !taken.has(id)) ??
      PALETTE_ORDER[erps.indexOf(entry) % PALETTE_ORDER.length];
    taken.add(free);
    chosen[entry.id] = { ...PALETTES[free], from: "list" };
  }
  return chosen;
}

/**
 * Whether an ERP answers, as the band and the Overview's ERPs table say it: "Connected", or
 * "Not reachable" and why.
 * @param {{ reachable: boolean, error?: string }} entry one listed ERP
 */
export function erpStatusLine(entry) {
  if (entry.reachable) {
    return { reachable: true, text: "Connected" };
  }
  if (!entry.error) {
    return { reachable: false, text: "Not reachable" };
  }
  // The ERP's own reason often starts with its name; beside the name, it is not said twice.
  const own = `${entry.name} is `;
  const reason = String(entry.error).startsWith(own)
    ? String(entry.error).slice(own.length)
    : entry.error;
  return {
    reachable: false,
    text: `Not reachable: ${String(reason).trim().replace(ENDED, "")}`,
  };
}

/**
 * The Overview's row for one ERP, in its ERPs list: when it last sent something, and how many
 * of its events wait. Its counts and when Demo Builder filled it were dropped with the ERPs
 * grid (owner, 2026-10-14: overkill).
 * @param {object} entry one listed ERP
 * @param {object[]} history the Activity records the page read (newest first)
 * @param {Date} now
 * @param {{ onlyErp?: boolean }} [options] with one ERP, every update from an ERP is its own
 * @returns {{ key: string, lastUpdate: string, waiting: string }}
 */
export function erpRow(entry, history, now, options = {}) {
  const last = history.find(
    (record) =>
      record.direction === "from-erp" &&
      (options.onlyErp || (record.erpIds ?? []).includes(entry.id)),
  );
  const waiting = entry.counts?.events;
  return {
    key: entry.id,
    lastUpdate: last ? ago(last.lastAt, now) : "Nothing yet",
    waiting: waiting === undefined ? NONE : String(waiting),
  };
}

/**
 * Today's counts, from today's Activity records.
 * @param {object[]} history the Activity records
 * @param {Date} now
 * @param {string} [timeZone]
 */
export function todayCounts(history, now, timeZone) {
  const today = history.filter((record) =>
    sameDay(record.lastAt, now, timeZone),
  );
  const counted = (test) => today.filter(test).length;
  return {
    // Every change made in Commerce that reached an ERP, but orders, which have their own.
    commerceSent: counted(
      (r) =>
        r.direction === "to-erp" && r.kind !== "order" && r.outcome === "sent",
    ),
    erpApplied: counted(
      (r) => r.direction === "from-erp" && r.outcome === "applied",
    ),
    notThrough: counted((r) => isProblem(r, now.getTime())),
    ordersSent: counted((r) => r.kind === "order" && r.outcome === "sent"),
  };
}
