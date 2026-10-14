/*
 * What the Activity feed and Needs attention say about each record (lib/history.js), kept apart
 * from the React that renders it so it can be tested without a browser: the direction, the
 * ERPs it concerns, its type, one sentence, how it ended, whether Retry is offered, and what a
 * click on it opens in the side panel.
 */

import { publishProblems, STARTED_BY } from "#web/publish-view.js";
import { recordFields, recordLine } from "#web/record-fields.js";
import { dayOf } from "#web/time-view.js";

const TRAILING_ERP = /\s+ERP$/iu;

/** "Northwind ERP" → "Northwind", for a chip. Re-exported by overview-view.js. */
export const shortName = (name) =>
  String(name ?? "").replace(TRAILING_ERP, "") || String(name ?? "");

/**
 * How each outcome reads: four words, as integration logs use (owner, 2026-10-14). Who refused
 * a record, and why, is its reason's (reasonOf); which way it went is the ERP column's arrow.
 */
export const RESULT = {
  applied: "Done",
  done: "Done",
  dropped: "Failed",
  failed: "Failed",
  held: "Waiting",
  refused: "Failed",
  sending: "In progress",
  sent: "Done",
};

/** Who stopped a record, before its reason, where the outcome says. */
const REFUSED_BY = { dropped: "Not sent", refused: "Refused by Commerce" };
/** The ERP's word for its customer; the page calls it a customer everywhere. */
const PARTNER_WORD = /\bpartner\b/gu;

/** The status light's tone for each outcome (admin-status.jsx). */
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
  { id: "products", label: "Products" },
  { id: "reset", label: "Demo reset" },
]);

/** Each kind of record: its filter type, its chip, and what a click on it opens. */
const KINDS = {
  block: { label: "Company block", opens: "company", type: "companies" },
  cancel: { label: "Cancel", opens: "trace", type: "orders" },
  changed: { label: "Order change", opens: "trace", type: "orders" },
  // A company saved in Commerce, sent to every ERP (2026-10-14).
  "company-saved": {
    label: "Company saved",
    opens: "company",
    type: "companies",
  },
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
  // A price publish: one run, its rows moved in its panel (2026-10-14).
  "price-publish": { label: "Price publish", opens: "publish", type: "prices" },
  // A save in Commerce told to the product's ERP (2026-10-13).
  "product-changed": {
    label: "Product changed",
    opens: "product",
    type: "products",
  },
  // A product made in Commerce, sent to its ERP (2026-10-14).
  "product-created": {
    label: "Product created",
    opens: "product",
    type: "products",
  },
  // Recorded only: no ERP is told (AB-26y step 5).
  "product-deleted": {
    label: "Product deleted",
    opens: "product",
    type: "products",
  },
  reset: { label: "Demo reset", opens: "reset", type: "reset" },
  return: { label: "Return received", opens: "trace", type: "orders" },
  returned: { label: "Return", opens: "order", type: "orders" },
  shipment: { label: "Shipment", opens: "trace", type: "orders" },
  shipped: { label: "Shipment", opens: "order", type: "orders" },
  stock: { label: "Stock", opens: "product", type: "stock" },
  // A stock quantity saved in Commerce, sent to the product's ERP (2026-10-14).
  "stock-changed": { label: "Stock changed", opens: "product", type: "stock" },
};

/** A change made in Commerce Admin, in the words of the row's second line. */
const MADE_IN_COMMERCE = {
  changed: "Changed in Commerce Admin",
  // A buyer can make a company on the storefront, so not "in Commerce Admin".
  "company-saved": "Saved in Commerce",
  invoiced: "Invoiced in Commerce Admin",
  "product-changed": "Changed in Commerce Admin",
  "product-created": "Created in Commerce Admin",
  // A buyer can ask for a return on the storefront, so not "in Commerce Admin".
  returned: "Returned in Commerce",
  shipped: "Shipped in Commerce Admin",
  "stock-changed": "Changed in Commerce Admin",
};

const NOT_APPLIED = " — not applied: ";
const ORDER_REFUSED =
  /^(?:commerce )?order (\S+) was refused by the ERP: (.+)$/iu;
const ORDER_WAITING = /^order (\S+) is waiting for the ERP \((.+)\)\.?$/iu;
const SUBJECT = /^(?:customer|company|partner) [^\s:]+/u;
const PARTNER = /^partner /u;
const SKU_PREFIX = /^SKU /u;
const FULL_STOP = /\.$/u;
/** Where a split order's record starts its next part's sentence (router/route-order.js). */
const NEXT_PART = /(?<=\.) (?=order )/iu;
const SPACES = /\s+/u;
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

/**
 * Parts of a row's second line as plain sentences, each ended by a full stop. They were joined
 * by middle dots until 2026-10-14, which the owner reads as machine-written.
 */
const asSentences = (parts) => {
  const kept = parts
    .map((part) => part.trim().replace(FULL_STOP, ""))
    .filter(Boolean);
  return kept.length > 0 ? `${kept.join(". ")}.` : "";
};

/**
 * An order that did not get through, in plainer words than its record's: who refused it and
 * why, or what it waits for. Null for any other record. (A held split order's waiting part
 * was named by matching "sent to <ERP> as", which only the preview's records ever wrote; a
 * real part reads "<ERP> took its part as sales order N", lib/order-sync.js. Removed
 * 2026-10-14: the ERP column names the order's ERPs and the second line says which waits.)
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
  return entry.outcome === "held" && named.length > 1
    ? { said: partsSaid(message, entry.ref), sentence: null }
    : null;
}

/**
 * A split order's parts, as its record joins them (router/route-order.js combine): each part's
 * sentence without the order's own number, which the row already leads with, and a waiting
 * part by its reason. "order 1: Northwind ERP took its part as sales order 7. order 1 is
 * waiting for the ERP (Contoso ERP is offline)." reads "Northwind ERP took its part as sales
 * order 7. Contoso ERP is offline."
 */
function partsSaid(message, ref) {
  const escaped = String(ref).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const own = new RegExp(`^order ${escaped}:?\\s*`, "iu");
  return asSentences(
    message.split(NEXT_PART).map((part) => {
      const waiting = ORDER_WAITING.exec(part.trim());
      return capitalized(waiting ? waiting[2] : part.trim().replace(own, ""));
    }),
  );
}

/** The attempts, and who made the last one when it was a person. */
function triesText(entry) {
  if (!(entry.attempts > 1)) {
    return entry.retriedBy ? `Retried by an ${entry.retriedBy}` : "";
  }
  const tries = `${entry.attempts} tries`;
  return entry.retriedBy ? `${tries}, last by an ${entry.retriedBy}` : tries;
}

/** The row's second line: what the message says after its first sentence, and the tries. */
function detailOf(entry, split, now, said) {
  if (entry.kind === "price-publish") {
    return asSentences([STARTED_BY[entry.by] ?? "", triesText(entry)]);
  }
  const stuck =
    entry.outcome === "sending" && canRetry(entry, now)
      ? "Still sending after 2 minutes"
      : "";
  return asSentences([
    MADE_IN_COMMERCE[entry.kind] ?? "",
    said ?? (entry.kind === "reset" ? "" : split.rest),
    split.reason ? `Not applied: ${split.reason}` : "",
    stuck,
    DELIVERED_AGAIN.has(entry.outcome) && retryOf(entry)
      ? "Retries automatically for up to a day"
      : "",
    triesText(entry),
  ]);
}

/**
 * Why a record did not get through, as one line under its Result: the reason Commerce or the
 * ERP gave, or what it waits for. Retries and attempts are the side panel's (`detail`).
 */
function reasonOf(entry, split, now, line, named, erps) {
  if (entry.kind === "price-publish") {
    // The first failure, and how many more: the panel lists them all.
    const erpName = (id) => erps.find((e) => e.id === id)?.name ?? `ERP ${id}`;
    const [first, ...more] = publishProblems({ failed: entry.failed }, erpName);
    return more.length > 0
      ? `${first} (and ${more.length} more)`
      : (first ?? "");
  }
  if (entry.outcome === "sending") {
    return canRetry(entry, now) ? "Still sending after 2 minutes" : "";
  }
  const why = line?.said ?? split.reason ?? split.rest ?? "";
  // A split order's line names each part; the reason is the part that waits.
  const parts = why.split(". ").filter(Boolean);
  // As given: a reason can start with a SKU or another value, whose case is its own.
  const reason = (parts.at(-1) ?? "")
    .replace(FULL_STOP, "")
    .replace(PARTNER_WORD, "customer");
  const by = refusedBy(entry, named);
  return by && reason ? `${by}: ${reason}` : by || reason;
}

/** "Refused by Northwind ERP" for an order its ERP refused; else the outcome's own word. */
function refusedBy(entry, named) {
  const refused = ORDER_REFUSED.test(String(entry.message ?? "").trim());
  if (entry.outcome === "dropped" && refused) {
    return named.length === 1
      ? `Refused by ${named[0].name}`
      : "Refused by the ERP";
  }
  return REFUSED_BY[entry.outcome] ?? "";
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
  if (opens === "publish") {
    return { kind: "publish" };
  }
  return opens === "reset" ? { kind: "reset" } : { kind: "record" };
}

const DIRECTIONS = {
  // Made in Commerce and told to no ERP (a product delete).
  commerce: ["commerce", "In Commerce"],
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
  const fields = recordFields(entry);
  return {
    at: entry.lastAt,
    // The log's columns (record-fields.js): the record in Commerce and in the ERP, and what
    // happened in plain words. A kind it does not know shows its message's sentence there.
    commerce: fields?.commerce ?? "",
    detail: detailOf(entry, split, at, line?.said),
    details: fields
      ? fields.details
      : (line?.sentence ?? sentenceOf(entry, split.first, named)),
    direction,
    directionLabel,
    entry,
    erpIds,
    erpRecord: fields?.erp ?? "",
    everyErp: entry.kind === "reset",
    // An ERP event by its id; anything else (a price publish has none) by kind and ref.
    key: entry.eventId ? `erp.${entry.eventId}` : `${entry.kind}.${entry.ref}`,
    // A side that is absent where its absence is the point: "Not paired", "Not in the ERP".
    missing: fields?.missing ?? {},
    open: openOf(entry),
    problem: isProblem(entry, at),
    // Why a record did not get through, in one line; the whole story is `detail`.
    reason: isProblem(entry, at)
      ? reasonOf(entry, split, now, line, named, erps)
      : "",
    result: RESULT[entry.outcome] ?? entry.outcome,
    retriable: retry !== null && canRetry(entry, at),
    retry,
    sentence: fields
      ? recordLine(fields)
      : (line?.sentence ?? sentenceOf(entry, split.first, named)),
    tone: TONE[entry.outcome] ?? "neutral",
    type: KINDS[entry.kind]?.type ?? "orders",
    typeLabel: KINDS[entry.kind]?.label ?? entry.kind,
    unnamed: erpIds.length === 0 && entry.kind !== "reset",
  };
}

/**
 * What a search matches a row by: its sentence and second line, the record's own number, the
 * order it belongs to, its ERP sales order, and the company it names.
 */
function searchText(row) {
  const { entry } = row;
  return [
    row.sentence,
    row.commerce,
    row.erpRecord,
    row.details,
    row.detail,
    entry.ref,
    entry.orderRef,
    entry.erpNumber,
    entry.company?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Whether a row shows under the feed's filters.
 * @param {object} row an eventRow
 * @param {{ erp: string, type: string, problems: boolean, text?: string, from?: string,
 *   to?: string }} filters "" is every ERP or type; `text` keeps the rows whose words hold
 *   every word typed, in any order; `from` and `to` are days (YYYY-MM-DD), both kept
 * @param {string} [timeZone] the zone the days are in; the browser's when omitted
 */
export function rowMatches(row, filters, timeZone) {
  const { erp, from, problems, text = "", to, type } = filters;
  const words = text.toLowerCase().split(SPACES).filter(Boolean);
  const found = searchText(row);
  const day = dayOf(row.at, timeZone);
  return (
    (!erp || row.erpIds.includes(erp)) &&
    (!type || row.type === type) &&
    (!problems || row.problem) &&
    (!from || day >= from) &&
    (!to || day <= to) &&
    words.every((word) => found.includes(word))
  );
}

/** Needs attention: every record that did not get through, as feed rows. */
export function needsAttention(entries, context) {
  return entries
    .filter((entry) => isProblem(entry, context.now.getTime()))
    .map((entry) => eventRow(entry, context));
}
