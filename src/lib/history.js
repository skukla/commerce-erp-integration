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
 * A skipped change (not this ERP's, nothing to do) leaves no row.
 * @param {string} kind shipped | invoiced | changed
 * @param {object} value the event's value (increment_id, entity_id, order_id)
 * @param {{ outcome: string, statusCode: number, message: string }} result
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
    }),
    options,
  );
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
