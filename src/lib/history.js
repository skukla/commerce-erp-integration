/*
 * What crossed between Commerce and the ERP, and how it ended: the integration's history,
 * shown on the Commerce Admin screen with a Retry on what did not get through. Orders sent
 * to the ERP are recorded here; ERP events applied to Commerce in lib/erp-event-history.js,
 * through `updateRecord`.
 *
 * One record per ORDER, not per attempt. An order the ERP cannot take is delivered again by
 * I/O Events (at 1, 2, 4 and 8 minutes, then every 15 minutes, for up to a day), so a line per
 * attempt would bury the story; the record counts the tries and keeps the first and last time.
 *
 * Each record is its own key in App Builder State, so orders saved in parallel never
 * overwrite each other — the company ledger's one-key array would. Records are kept 14 days.
 * `skipped` is not recorded: it answers every later save of an order that is not new.
 *
 * Recording never breaks a sync: a storage failure is logged and swallowed.
 */
import stateLib from "@adobe/aio-lib-state";

const PREFIX = "history.";
const TTL_SECONDS = 14 * 24 * 60 * 60;
/** What did not get through: orders held or not sent, ERP events not applied yet or refused. */
const FAILED = new Set(["held", "dropped", "failed", "refused"]);
const DEFAULT_LIMIT = 100;

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetHistoryClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

/**
 * Write one record: `build` gets the record as it stands (or undefined) and the time, and
 * answers the new one. Never throws — recording must not break the sync it records.
 * @param {string} key the record's key, under `history.`
 * @param {(before: object|undefined, now: string) => object} build
 * @param {object} [logger]
 * @returns {Promise<void>}
 */
export async function updateRecord(key, build, logger) {
  try {
    const client = await state();
    const previous = await client.get(`${PREFIX}${key}`);
    const before = previous?.value ? JSON.parse(previous.value) : undefined;
    const entry = build(before, new Date().toISOString());
    await client.put(`${PREFIX}${key}`, JSON.stringify(entry), {
      ttl: TTL_SECONDS,
    });
  } catch (error) {
    logger?.warn(`history: ${key} not recorded: ${error.message}`);
  }
}

/**
 * Record how one order's send to the ERP ended.
 * @param {object} order the order (its `increment_id`)
 * @param {{ outcome: string, message: string }} result `sendOrderToErp`'s answer
 * @param {{ retriedBy?: string, logger?: object }} [options]
 * @returns {Promise<void>}
 */
/**
 * A change made in Commerce that was told to the ERP (or not), for the Admin screen's
 * history: one record per Commerce document and kind, so a redelivery updates its own row.
 * A skipped change (not this ERP's, nothing to do) leaves no row. With several ERPs the
 * result names the ERPs it went to (`erpIds`, the order's parts) and the order (`orderRef`),
 * which the record keeps, so the page's row names each ERP and opens the order's trace.
 * @param {string} kind shipped | invoiced | changed
 * @param {object} value the event's value (increment_id, entity_id, order_id)
 * @param {{ outcome: string, statusCode: number, message: string, erpIds?: string[],
 *   orderRef?: string }} result
 */
export async function recordCommerceChange(kind, value, result, options = {}) {
  if (result.outcome === "skipped") {
    return;
  }
  const ref = String(
    value?.increment_id ?? value?.entity_id ?? value?.order_id ?? "",
  );
  if (!ref) {
    return;
  }
  await updateRecord(
    `commerce.${kind}.${ref}`,
    (before, now) => ({
      attempts: (before?.attempts ?? 0) + 1,
      direction: "to-erp",
      firstAt: before?.firstAt ?? now,
      kind,
      lastAt: now,
      message: result.message,
      outcome: result.outcome,
      ref,
      ...(result.erpIds ? { erpIds: result.erpIds } : {}),
      ...(result.orderRef ? { orderRef: String(result.orderRef) } : {}),
    }),
    options,
  );
}

/**
 * A product changed in Commerce, for the Admin screen's history. One record per SKU and
 * kind, so a later save, or a redelivery, updates its own row.
 *
 * - `product-deleted` (AB-26y step 5): recorded here and told to no ERP, so its direction
 *   is "commerce" and its outcome "done".
 * - `product-created`, `product-changed`: a product made or saved in Commerce, told to its
 *   ERP, "to-erp", "sent" or "failed". A save sends the name, the price and the stock
 *   whatever changed (Commerce's event does not say which attribute did), and `sent` names
 *   them, so the row says what the ERP was told. Before 2026-10-13 a save left no record;
 *   before 2026-10-14 a new product left none.
 * - `stock-changed`: a stock quantity saved in Commerce, told to the ERP, with each
 *   source's quantity (`stock`). Before 2026-10-14 it left no record.
 *
 * A save after one that got through is a new change, not another try: only a redelivery of
 * one that failed counts as an attempt.
 *
 * The key carries the SKU in hex: State keys take only letters, digits, "-", "_" and ".",
 * and a SKU may hold anything.
 * @param {"product-created"|"product-changed"|"product-deleted"|"stock-changed"} kind
 * @param {string} sku the product
 * @param {{ message: string, outcome?: string, erpIds?: string[], sent?: string[],
 *   stock?: Array<{ name: string, quantity: number }> }} result what the row says, how it
 *   ended (default "done"), the ERPs concerned (several ERPs), and what was sent
 * @param {object} [logger]
 * @returns {Promise<void>}
 */
export async function recordProductChange(kind, sku, result, logger) {
  const { erpIds, message, outcome = "done", sent, stock } = result;
  await updateRecord(
    `commerce.${kind}.${Buffer.from(sku, "utf8").toString("hex")}`,
    (before, now) => ({
      ...tries(before, now),
      direction: kind === "product-deleted" ? "commerce" : "to-erp",
      kind,
      lastAt: now,
      message,
      outcome,
      ref: sku,
      ...(erpIds ? { erpIds } : {}),
      ...(sent ? { sent } : {}),
      ...(stock ? { stock } : {}),
    }),
    logger,
  );
}

/**
 * A company saved in Commerce, told to every ERP (actions/company/commerce/saved): one record
 * per company, with its name and the customer it is in each ERP. Before 2026-10-14 it left no
 * record, so a company sent to every ERP showed nowhere.
 * @param {number} companyId the Commerce company
 * @param {{ message: string, outcome: string, erpIds: string[], name?: string,
 *   customers?: string[] }} result
 * @param {object} [logger]
 * @returns {Promise<void>}
 */
export async function recordCompanySave(companyId, result, logger) {
  const { customers, erpIds, message, name, outcome } = result;
  await updateRecord(
    `commerce.company-saved.${companyId}`,
    (before, now) => ({
      ...tries(before, now),
      company: { id: companyId, ...(name ? { name } : {}) },
      direction: "to-erp",
      erpIds,
      kind: "company-saved",
      lastAt: now,
      message,
      outcome,
      ref: String(companyId),
      ...(customers?.length ? { customers } : {}),
    }),
    logger,
  );
}

/** A save after one that got through starts again; a redelivery of a failed one is a try. */
function tries(before, now) {
  return before && FAILED.has(before.outcome)
    ? { attempts: before.attempts + 1, firstAt: before.firstAt }
    : { attempts: 1, firstAt: now };
}

export async function recordOrderOutcome(order, result, options = {}) {
  if (result.outcome === "skipped" || !order?.increment_id) {
    return;
  }
  await updateRecord(
    `order.${order.increment_id}`,
    (before, now) => ({
      // A step recorded mid-send (`progress`) is not another attempt.
      attempts: (before?.attempts ?? 0) + (options.progress ? 0 : 1),
      direction: "to-erp",
      firstAt: before?.firstAt ?? now,
      kind: "order",
      lastAt: now,
      message: result.message,
      outcome: result.outcome,
      ref: String(order.increment_id),
      // The ERP's number, once it answered one: kept through later records, so a failed
      // write-back still says which sales order the ERP made (D8).
      ...(result.erpNumber || before?.erpNumber
        ? { erpNumber: result.erpNumber ?? before.erpNumber }
        : {}),
      ...(options.retriedBy ? { retriedBy: options.retriedBy } : {}),
    }),
    options.logger,
  );
}

/** The most rows a publish's record keeps: State holds a value up to 1 MB. */
const MAX_PUBLISH_CHANGES = 200;

/**
 * A price publish, for the Admin screen's history (2026-10-14): what it wrote and took back,
 * each row moved before and after, and the customers it skipped or failed. Before, only its
 * counts were kept, in the scheduled run's record (lib/scheduled-runs.js), and nothing showed
 * under Activity.
 *
 * Most hourly runs change nothing, and a run that changes nothing and fails nothing leaves no
 * row: it would bury the log. One that changed something is a row of its own. One that only
 * failed updates a single row in place (`prices.failing`), its attempts counting the runs, so
 * an ERP that stays away does not leave a row an hour; the next run that fails nothing
 * removes it.
 * @param {{ erps: string[], written: number, removed: number, unchanged: number,
 *   changes?: object[], skipped: object[], failed: object[] }} total lib/publish-prices.js
 * @param {"schedule"|"demo-builder"} by what started it
 * @param {object} [logger]
 * @returns {Promise<void>}
 */
export async function recordPricePublish(total, by, logger) {
  const changes = total.changes ?? [];
  const failed = total.failed ?? [];
  const changed = total.written + total.removed > 0;
  if (!changed && failed.length === 0) {
    await forgetRecord("prices.failing", logger);
    return;
  }
  const at = new Date().toISOString();
  const key = changed ? `prices.${Date.parse(at)}` : "prices.failing";
  await updateRecord(
    key,
    (before, now) => ({
      ...(changed ? { attempts: 1, firstAt: now } : tries(before, now)),
      by,
      changes: changes.slice(0, MAX_PUBLISH_CHANGES),
      direction: "from-erp",
      erpIds: total.erps,
      failed,
      kind: "price-publish",
      lastAt: now,
      message: `Prices published: wrote ${total.written}, removed ${total.removed}, unchanged ${total.unchanged}, skipped ${total.skipped.length}, failed ${failed.length}`,
      moreChanges: Math.max(0, changes.length - MAX_PUBLISH_CHANGES),
      outcome: failed.length > 0 ? "failed" : "applied",
      ref: key.slice("prices.".length),
      removed: total.removed,
      skipped: total.skipped,
      unchanged: total.unchanged,
      written: total.written,
    }),
    logger,
  );
  if (changed && failed.length === 0) {
    await forgetRecord("prices.failing", logger);
  }
}

/** Delete one record, if there is one. Never throws, as {@link updateRecord}. */
async function forgetRecord(key, logger) {
  try {
    await (await state()).delete(`${PREFIX}${key}`);
  } catch (error) {
    logger?.warn(`history: ${key} not removed: ${error.message}`);
  }
}

/**
 * Delete every history record (a demo reset starts the page again, AB-16n).
 * @returns {Promise<number>} how many were deleted
 */
export async function clearHistory() {
  const client = await state();
  const keys = [];
  for await (const page of client.list({ match: `${PREFIX}*` })) {
    keys.push(...page.keys);
  }
  for (const key of keys) {
    // biome-ignore lint/performance/noAwaitInLoops: one delete per record, few records
    await client.delete(key);
  }
  return keys.length;
}

/**
 * The one line a demo reset leaves: that it happened, when, and what it closed.
 * @param {string} message what the reset did, in words
 * @param {object} [logger]
 * @returns {Promise<void>}
 */
export async function recordReset(message, logger) {
  const now = new Date().toISOString();
  // The key in milliseconds: State keys take only letters, digits, "-", "_" and "." (an ISO
  // time's ":" made the put fail, silently, on Bodea 2026-09-28).
  await updateRecord(
    `reset.${Date.parse(now)}`,
    () => ({
      attempts: 1,
      direction: "reset",
      firstAt: now,
      kind: "reset",
      lastAt: now,
      message,
      outcome: "done",
      ref: now.slice(0, 10),
    }),
    logger,
  );
}

/**
 * One record by its key under `history.`, or undefined.
 * @param {string} key e.g. `erp.<event id>`
 * @returns {Promise<object|undefined>}
 */
export async function readRecord(key) {
  const found = await (await state()).get(`${PREFIX}${key}`);
  return found?.value ? JSON.parse(found.value) : undefined;
}

/**
 * The history, newest first.
 * @param {{ limit?: number, failedOnly?: boolean, ref?: string }} [filter]
 * @returns {Promise<object[]>}
 */
export async function readHistory(filter = {}) {
  const client = await state();
  const keys = [];
  for await (const page of client.list({ match: `${PREFIX}*` })) {
    keys.push(...page.keys);
  }
  const entries = [];
  for (const key of keys) {
    // biome-ignore lint/performance/noAwaitInLoops: one read per record, few records
    const found = await client.get(key);
    if (found?.value) {
      entries.push(JSON.parse(found.value));
    }
  }
  return entries
    .filter((e) => !filter.failedOnly || FAILED.has(e.outcome))
    .filter((e) => filter.ref === undefined || e.ref === String(filter.ref))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, filter.limit ?? DEFAULT_LIMIT);
}
