/*
 * What the Activity feed and Needs attention say about each record (lib/history.js), kept apart
 * from the React that renders it so it can be tested without a browser: the direction, the
 * ERPs it concerns, its type, one sentence, how it ended, whether Retry is offered, and what a
 * click on it opens in the side panel.
 */
import { dayHeading } from "#web/time-view.js";

const TRAILING_ERP = /\s+ERP$/iu;

/** "Northwind ERP" → "Northwind", for a chip. Re-exported by overview-view.js. */
export const shortName = (name) =>
  String(name ?? "").replace(TRAILING_ERP, "") || String(name ?? "");

/** How each outcome reads to a merchant. */
export const RESULT = {
  applied: "Applied",
  done: "Done",
  dropped: "Not sent",
  failed: "Not applied yet",
  held: "Waiting for the ERP",
  refused: "Refused by Commerce",
  sending: "Sending",
  sent: "Sent",
};

/** The badge's color for each outcome. */
const TONE = {
  applied: "ok",
  done: "neutral",
  dropped: "bad",
  failed: "bad",
  held: "warn",
  refused: "bad",
  sending: "warn",
  sent: "ok",
};

/** A send still "sending" after this long did not finish (an action is cut off at 60 s). */
const STUCK_AFTER_MS = 2 * 60 * 1000;

const NOT_THROUGH = new Set(["held", "dropped", "failed", "refused"]);
/** What I/O Events delivers again by itself, for up to a day. */
const DELIVERED_AGAIN = new Set(["held", "failed"]);

/** The feed's type filter, in order. */
export const TYPES = Object.freeze([
  { id: "orders", label: "Orders" },
  { id: "prices", label: "Prices" },
  { id: "stock", label: "Stock" },
  { id: "companies", label: "Companies" },
  { id: "reset", label: "Demo reset" },
]);

/** Each kind of record: its filter type, its chip, and what a click on it opens. */
const KINDS = {
  block: { label: "Company block", opens: "company", type: "companies" },
  cancel: { label: "Cancel", opens: "trace", type: "orders" },
  changed: { label: "Order change", opens: "trace", type: "orders" },
  contract: { label: "Customer prices", opens: "company", type: "prices" },
  credit: { label: "Credit", opens: "company", type: "companies" },
  "credit-memo": { label: "Credit memo", opens: "trace", type: "orders" },
  hold: { label: "Credit hold", opens: "trace", type: "orders" },
  invoice: { label: "Invoice", opens: "trace", type: "orders" },
  invoiced: { label: "Invoice", opens: "order", type: "orders" },
  order: { label: "Order", opens: "trace", type: "orders" },
  "order-status": { label: "Order status", opens: "trace", type: "orders" },
  payment: { label: "Payment", opens: "trace", type: "orders" },
  price: { label: "Price", opens: "product", type: "prices" },
  reset: { label: "Demo reset", opens: "reset", type: "reset" },
  return: { label: "Return received", opens: "trace", type: "orders" },
  returned: { label: "Return", opens: "order", type: "orders" },
  shipment: { label: "Shipment", opens: "trace", type: "orders" },
  shipped: { label: "Shipment", opens: "order", type: "orders" },
  stock: { label: "Stock", opens: "product", type: "stock" },
};

/** A change made in Commerce Admin, in the words of the row's second line. */
const MADE_IN_COMMERCE = {
  changed: "Changed in Commerce Admin",
  invoiced: "Invoiced in Commerce Admin",
  // A buyer can ask for a return on the storefront, so not "in Commerce Admin".
  returned: "Return made in Commerce",
  shipped: "Shipped in Commerce Admin",
};

const NOT_APPLIED = " — not applied: ";
const ORDER_REFUSED =
  /^(?:commerce )?order (\S+) was refused by the ERP: (.+)$/iu;
const ORDER_WAITING = /^order (\S+) is waiting for the ERP \((.+)\)\.?$/iu;
const SENT_TO = /sent to (.+?) as /gu;
const SUBJECT = /^(?:customer|company|partner) [^\s:]+/u;
const PARTNER = /^partner /u;
const SKU_PREFIX = /^SKU /u;
const FULL_STOP = /\.$/u;
/** The ERP's raw "partner X: N price line(s) in force" (lib/erp-event-history.js). */
const PRICE_LINES = /^partner (\S+): (\d+) price line\(s\) in force$/u;

/**
 * Retry is offered for anything that did not get through. Held orders and failed ERP
 * events are also delivered again by I/O Events for up to a day; a person need not wait.
 */
export function canRetry(entry, now = Date.now()) {
  if (entry.outcome === "sending") {
    return now - Date.parse(entry.lastAt) > STUCK_AFTER_MS;
  }
  return NOT_THROUGH.has(entry.outcome);
}

/** Whether a record did not get through (Needs attention, Problems only, today's count). */
export const isProblem = (entry, now = Date.now()) => canRetry(entry, now);

/** What a Retry sends: an ERP event by its id, an order by its number; nothing else. */
function retryOf(entry) {
  if (entry.direction === "from-erp" && entry.eventId) {
    return { eventId: entry.eventId };
  }
  if (entry.direction === "to-erp" && entry.kind === "order") {
    return { incrementId: entry.ref };
  }
  return null;
}

const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** The record's message as one sentence and what follows it. */
function splitMessage(entry) {
  const [said, reason] = String(entry.message ?? "").split(NOT_APPLIED);
  const stop = said.indexOf(". ");
  const first = stop < 0 ? said : said.slice(0, stop);
  const rest = stop < 0 ? "" : said.slice(stop + 2);
  return {
    first: first.trim().replace(FULL_STOP, ""),
    reason: reason?.trim(),
    rest: rest.trim().replace(FULL_STOP, ""),
  };
}

/**
 * "Partner 100042: 3 price line(s) in force" as a business user reads it: the Commerce
 * company's name when it is known, else the ERP that named it (with one listed) and its
 * customer number; "1 customer price" singular, "N customer prices" plural.
 */
function contractSentence(entry, first, named) {
  const parsed = PRICE_LINES.exec(first);
  if (!parsed) {
    return capitalized(first.replace(PARTNER, "customer "));
  }
  const [, partnerId, countText] = parsed;
  const count = Number(countText);
  const priced = count === 1 ? "1 customer price" : `${count} customer prices`;
  const who =
    entry.company?.name ??
    (named.length === 1
      ? `${shortName(named[0].name)} customer ${partnerId}`
      : `Customer ${partnerId}`);
  return `${who}: ${priced} in force`;
}

/**
 * The sentence, with a company's Commerce name for its ERP customer number. A SKU or a company's
 * name leads as it is written; the integration's own words are capitalized.
 */
function sentenceOf(entry, first, named) {
  if (entry.kind === "reset") {
    return String(entry.message ?? "");
  }
  if (SKU_PREFIX.test(first)) {
    return first.replace(SKU_PREFIX, "");
  }
  if (entry.kind === "contract") {
    return contractSentence(entry, first, named);
  }
  if (entry.company?.name && SUBJECT.test(first)) {
    return first.replace(SUBJECT, entry.company.name);
  }
  return capitalized(first);
}

/** Every sentence of a message, one after another, as the row's second line reads. */
const sentences = (message) =>
  message
    .split(". ")
    .map((part) => part.trim().replace(FULL_STOP, ""))
    .filter(Boolean)
    .join(" · ");

/**
 * An order that did not get through, in plainer words than its record's: who refused it and
 * why, what it waits for, and with several ERPs whose part waits (a part sent reads "sent to
 * <ERP> as <number>" in the record, lib/order-parts.js). Null for any other record.
 * @param {object} entry the record
 * @param {object[]} named the listed ERPs the record concerns
 * @returns {{ sentence: string, said: string } | null}
 */
function orderLine(entry, named) {
  if (!(entry.direction === "to-erp" && entry.kind === "order")) {
    return null;
  }
  const message = String(entry.message ?? "").trim();
  const refused = ORDER_REFUSED.exec(message);
  if (refused) {
    const by = named.length === 1 ? named[0].name : "the ERP";
    return {
      said: refused[2].replace(FULL_STOP, ""),
      sentence: `Order ${refused[1]} was refused by ${by}`,
    };
  }
  const waiting = ORDER_WAITING.exec(message);
  if (waiting) {
    return {
      said: capitalized(waiting[2]),
      sentence: `Order ${waiting[1]} is waiting for the ERP`,
    };
  }
  if (entry.outcome !== "held" || named.length < 2) {
    return null;
  }
  const sent = new Set([...message.matchAll(SENT_TO)].map((match) => match[1]));
  const waits = named.filter((e) => !sent.has(e.name)).map((e) => e.name);
  if (waits.length === 0) {
    return null;
  }
  return {
    said: sentences(message),
    sentence: `Order ${entry.ref}: ${waits.join(" and ")}’s ${waits.length === 1 ? "part is" : "parts are"} waiting`,
  };
}

/** The attempts, and who made the last one when it was a person. */
function triesText(entry) {
  if (!(entry.attempts > 1)) {
    return entry.retriedBy ? `The last try by an ${entry.retriedBy}` : "";
  }
  const tries = `${entry.attempts} tries`;
  return entry.retriedBy
    ? `${tries}, the last by an ${entry.retriedBy}`
    : tries;
}

/** The row's second line: what the message says after its first sentence, and the tries. */
function detailOf(entry, split, now, said) {
  const stuck =
    entry.outcome === "sending" && canRetry(entry, now)
      ? "Still sending after 2 minutes, so Retry is offered"
      : "";
  return [
    MADE_IN_COMMERCE[entry.kind] ?? "",
    said ?? (entry.kind === "reset" ? "" : split.rest),
    split.reason ? `Not applied: ${split.reason}` : "",
    stuck,
    DELIVERED_AGAIN.has(entry.outcome) && retryOf(entry)
      ? "Sent again by itself for up to a day"
      : "",
    triesText(entry),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What a click on the row opens in the side panel. */
function openOf(entry) {
  const opens = KINDS[entry.kind]?.opens;
  if (opens === "trace") {
    return { kind: "trace", ref: entry.ref };
  }
  if (opens === "order" && entry.orderRef) {
    return { kind: "trace", ref: entry.orderRef };
  }
  if (opens === "product" && entry.ref) {
    return { kind: "product", sku: entry.ref };
  }
  if (opens === "company" && entry.company?.id) {
    return { id: entry.company.id, kind: "company" };
  }
  return opens === "reset" ? { kind: "reset" } : { kind: "record" };
}

const DIRECTIONS = {
  "from-erp": ["from", "From ERP"],
  reset: ["reset", "Demo Builder"],
  "to-erp": ["to", "To ERP"],
};

/**
 * One row of the feed.
 * @param {object} entry a history record
 * @param {{ erps: object[], now: Date }} context the listed ERPs, and the time now
 * @returns {object} the row
 */
export function eventRow(entry, { erps, now }) {
  const onlyErp = erps.length === 1 ? erps[0].id : null;
  const listed = new Set(erps.map((e) => e.id));
  const erpIds = onlyErp
    ? [onlyErp]
    : (entry.erpIds ?? []).filter((id) => listed.has(id));
  const [direction, directionLabel] =
    DIRECTIONS[entry.direction] ?? DIRECTIONS["to-erp"];
  const split = splitMessage(entry);
  const named = erpIds.map((id) => erps.find((e) => e.id === id));
  const line = orderLine(entry, named);
  const retry = retryOf(entry);
  const at = now.getTime();
  return {
    at: entry.lastAt,
    detail: detailOf(entry, split, at, line?.said),
    direction,
    directionLabel,
    entry,
    erpIds,
    everyErp: entry.kind === "reset",
    key:
      entry.direction === "from-erp"
        ? `erp.${entry.eventId}`
        : `${entry.kind}.${entry.ref}`,
    open: openOf(entry),
    problem: isProblem(entry, at),
    result: RESULT[entry.outcome] ?? entry.outcome,
    retriable: retry !== null && canRetry(entry, at),
    retry,
    sentence: line?.sentence ?? sentenceOf(entry, split.first, named),
    tone: TONE[entry.outcome] ?? "neutral",
    type: KINDS[entry.kind]?.type ?? "orders",
    typeLabel: KINDS[entry.kind]?.label ?? entry.kind,
    unnamed: erpIds.length === 0 && entry.kind !== "reset",
  };
}

/**
 * Whether a row shows under the feed's filters.
 * @param {object} row an eventRow
 * @param {{ erp: string, type: string, problems: boolean }} filters "" is every ERP or type
 */
export function rowMatches(row, { erp, problems, type }) {
  return (
    (!erp || row.erpIds.includes(erp)) &&
    (!type || row.type === type) &&
    (!problems || row.problem)
  );
}

/**
 * The rows grouped by day, in the order given (newest first).
 * @returns {Array<{ key: string, title: string, date: string, rows: object[] }>}
 */
export function dayGroups(rows, now, timeZone) {
  const groups = [];
  for (const row of rows) {
    const heading = dayHeading(row.at, now, timeZone);
    const last = groups.at(-1);
    if (last?.key === heading.key) {
      last.rows.push(row);
    } else {
      groups.push({ ...heading, rows: [row] });
    }
  }
  return groups;
}

/** Needs attention: every record that did not get through, as feed rows. */
export function needsAttention(entries, context) {
  return entries
    .filter((entry) => isProblem(entry, context.now.getTime()))
    .map((entry) => eventRow(entry, context));
}
