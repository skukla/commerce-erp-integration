/*
 * What crossed between Commerce and the ERP, and how it ended: the integration's history,
 * shown on the Commerce Admin screen with a Retry on what did not get through.
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
const FAILED = new Set(["held", "dropped"]);
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

const orderKey = (incrementId) => `${PREFIX}order.${incrementId}`;

/**
 * Record how one order's send to the ERP ended.
 * @param {object} order the order (its `increment_id`)
 * @param {{ outcome: string, message: string }} result `sendOrderToErp`'s answer
 * @param {{ retriedBy?: string, logger?: object }} [options]
 * @returns {Promise<void>}
 */
export async function recordOrderOutcome(order, result, options = {}) {
  if (result.outcome === "skipped" || !order?.increment_id) {
    return;
  }
  try {
    const client = await state();
    const key = orderKey(order.increment_id);
    const previous = await client.get(key);
    const before = previous?.value ? JSON.parse(previous.value) : undefined;
    const now = new Date().toISOString();
    const entry = {
      attempts: (before?.attempts ?? 0) + 1,
      direction: "to-erp",
      firstAt: before?.firstAt ?? now,
      kind: "order",
      lastAt: now,
      message: result.message,
      outcome: result.outcome,
      ref: String(order.increment_id),
      ...(options.retriedBy ? { retriedBy: options.retriedBy } : {}),
    };
    await client.put(key, JSON.stringify(entry), { ttl: TTL_SECONDS });
  } catch (error) {
    options.logger?.warn(
      `history: order ${order.increment_id} not recorded: ${error.message}`,
    );
  }
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
