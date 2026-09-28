/*
 * What the page says about each ERP, kept apart from the React that renders it (as
 * history-view.js is): the ERPs as one list whether there is one or several, each ERP's color,
 * the band's chip, the Overview's card, and today's counts. Each listed ERP comes from
 * erp/status `erps` (several) or `erp` (one): its name, whether the integration can use it, why
 * not (a maintenance window, a refusal such as "the ERP answered 401", or a network error), its
 * figures, and how it looks (demo-erp's `appearance`).
 */
import { isProblem, shortName } from "#web/history-view.js";
import { dayAndTime, ago, sameDay } from "#web/time-view.js";

export { shortName };

const NONE = "–";
const ENDED = /[.!?]$/u;

/** The id the single ERP of an install has (src/lib/erps.js SINGLE_ERP_ID). */
const SINGLE_ERP_ID = "erp";

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

/** A reason as a sentence: capitalized, with its period. */
function sentence(text) {
  const trimmed = String(text).trim();
  const ended = ENDED.test(trimmed) ? trimmed : `${trimmed}.`;
  return ended.charAt(0).toUpperCase() + ended.slice(1);
}

/**
 * Whether an ERP answers, for the band's chip (`text`) and its card (`card`).
 * @param {{ reachable: boolean, error?: string }} entry one listed ERP
 */
export function erpStatusLine(entry) {
  if (entry.reachable) {
    return { card: "Connected", reachable: true, text: "Connected" };
  }
  if (!entry.error) {
    return { card: "Not reachable.", reachable: false, text: "Not reachable" };
  }
  // The ERP's own reason often starts with its name; beside the name, it is not said twice.
  const own = `${entry.name} is `;
  const reason = String(entry.error).startsWith(own)
    ? String(entry.error).slice(own.length)
    : entry.error;
  const why = sentence(reason);
  return {
    card: `Not reachable. ${why}`,
    reachable: false,
    text: `Not reachable · ${String(reason).trim().replace(ENDED, "")}`,
  };
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "3 products · 5 business partners · 3 sales orders", or a dash when the ERP gave none. */
function inErp(counts) {
  if (!counts) {
    return NONE;
  }
  const parts = [
    counts.products === undefined
      ? null
      : count(counts.products, "product", "products"),
    counts.businessPartners === undefined
      ? null
      : count(counts.businessPartners, "business partner", "business partners"),
    counts.salesOrders === undefined
      ? null
      : count(counts.salesOrders, "sales order", "sales orders"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : NONE;
}

/** When Demo Builder last filled and emptied the ERP. */
function fillLine(entry, now, timeZone) {
  if (!entry.lastImportAt) {
    return "Never filled by Demo Builder";
  }
  const filled = `Filled by Demo Builder ${dayAndTime(entry.lastImportAt, now, timeZone)}`;
  return entry.lastWipeAt
    ? `${filled} · emptied ${dayAndTime(entry.lastWipeAt, now, timeZone)}`
    : filled;
}

/**
 * The Overview's card for one ERP.
 * @param {object} entry one listed ERP
 * @param {object[]} history the Activity records the page read (newest first)
 * @param {Date} now
 * @param {string} [timeZone]
 * @param {{ onlyErp?: boolean }} [options] with one ERP, every update from an ERP is its own
 * @returns {{ inErp: string, lastUpdate: string, waiting: string, foot: string }}
 */
export function erpCard(entry, history, now, timeZone, options = {}) {
  const last = history.find(
    (record) =>
      record.direction === "from-erp" &&
      (options.onlyErp || (record.erpIds ?? []).includes(entry.id)),
  );
  const waiting = entry.counts?.events;
  return {
    foot: fillLine(entry, now, timeZone),
    inErp: inErp(entry.counts),
    lastUpdate: last ? ago(last.lastAt, now) : "Nothing yet",
    waiting: waiting === undefined ? NONE : String(waiting),
  };
}

/** A change made in Commerce Admin, told to the ERPs. */
const COMMERCE_CHANGES = new Set(["changed", "invoiced", "shipped"]);

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
    commerceSent: counted(
      (r) => COMMERCE_CHANGES.has(r.kind) && r.outcome === "sent",
    ),
    erpApplied: counted(
      (r) => r.direction === "from-erp" && r.outcome === "applied",
    ),
    notThrough: counted((r) => isProblem(r, now.getTime())),
    ordersSent: counted((r) => r.kind === "order" && r.outcome === "sent"),
  };
}
