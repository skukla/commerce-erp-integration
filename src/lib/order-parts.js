/*
 * The parts of each routed order (design v1 §3.3): which ERP owns which of its lines, what
 * happened to each part, and the lines no ERP (or two ERPs) claimed. One record per order in
 * App Builder State, like the write ledger (lib/ledger.js) and the key map (lib/key-map.js).
 *
 * A part is keyed by the order and the ERP's id, so a redelivered order event finds the parts
 * already sent and sends them again never.
 */
import stateLib from "@adobe/aio-lib-state";

import { releaseLock, takeLock } from "#lib/state-lock";

const TTL_SECONDS = 365 * 24 * 60 * 60;

/** The outcomes after which a part is never sent again. */
export const FINAL_OUTCOMES = Object.freeze(["sent", "skipped", "dropped"]);

/**
 * A part's status from its send. A part its ERP refused stays open, failed and `refused`, so
 * the order waits on it and staff can send it again; it is never dropped while the other parts
 * go (design v1 §3.3, one ERP down or refusing). Measured on Bodea 2026-09-28: an ERP that
 * answered 401 left its part dropped and the order Pending, with nothing to act on.
 * @param {{ outcome: string }} outcome the adapter's answer
 * @returns {{ status: string, refused?: true }}
 */
export function partStatusOf(outcome) {
  return outcome.outcome === "dropped"
    ? { refused: true, status: "failed" }
    : { status: outcome.outcome };
}

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetOrderPartsClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

const PARTS_PREFIX = "order-parts-";
const CLOSED_PREFIX = "order-reset-closed-";

const keySafe = (incrementId) =>
  String(incrementId).replace(/[^A-Za-z0-9_-]/gu, "_");

/** The State key of an order's parts, by the order number a shopper sees. */
export function orderPartsKey(incrementId) {
  return `${PARTS_PREFIX}${keySafe(incrementId)}`;
}

/**
 * The order number of every order with a parts record, read from the keys (a record does not
 * hold its own number). Commerce's order numbers are digits, which the key keeps as they are.
 * @returns {Promise<string[]>}
 */
export async function listOrderPartsIds() {
  const ids = [];
  for await (const page of (await state()).list({
    match: `${PARTS_PREFIX}*`,
  })) {
    ids.push(...page.keys.map((key) => key.slice(PARTS_PREFIX.length)));
  }
  return ids;
}

/** Delete an order's parts record; answers whether there was one. */
export async function deleteOrderParts(incrementId) {
  const client = await state();
  const key = orderPartsKey(incrementId);
  if (!(await client.get(key))?.value) {
    return false;
  }
  await client.delete(key);
  return true;
}

/**
 * Mark an order as closed by a demo reset (lib/close-orders.js), before the reset's first write
 * to it: the order events those writes raise must send nothing to an ERP. Kept as long as a
 * parts record: a cancelled order is never sent again.
 */
export async function markClosedByReset(incrementId, day) {
  await (await state()).put(
    `${CLOSED_PREFIX}${keySafe(incrementId)}`,
    JSON.stringify({ day }),
    { ttl: TTL_SECONDS },
  );
}

/** @returns {Promise<{ day: string }|null>} the reset's mark on an order, or null */
export async function closedByReset(incrementId) {
  const res = await (await state()).get(
    `${CLOSED_PREFIX}${keySafe(incrementId)}`,
  );
  if (!res?.value) {
    return null;
  }
  try {
    return JSON.parse(res.value);
  } catch {
    return { day: "unknown" };
  }
}

/**
 * @param {string} incrementId the order number
 * @returns {Promise<{ parts: object, unrouted: string[], conflicts: object[] }>}
 */
export async function readOrderParts(incrementId) {
  const res = await (await state()).get(orderPartsKey(incrementId));
  const empty = { conflicts: [], parts: {}, unrouted: [] };
  if (!res?.value) {
    return empty;
  }
  try {
    return { ...empty, ...JSON.parse(res.value) };
  } catch {
    return empty;
  }
}

/** Save an order's parts record whole. */
export async function writeOrderParts(incrementId, record) {
  await (await state()).put(
    orderPartsKey(incrementId),
    JSON.stringify(record),
    {
      ttl: TTL_SECONDS,
    },
  );
}

/*
 * One invoice at a time per order. Adobe's quality patch MDVA-40399 reports that two partial
 * invoices created at once on one order fail (reported, not re-verified), so every partial
 * invoice on an order is created under this lock — the shared State lease lock (lib/state-lock.js).
 */
function lockKey(incrementId) {
  return `order-invoice-lock-${String(incrementId).replace(/[^A-Za-z0-9_-]/gu, "_")}`;
}

/**
 * Take an order's invoice lock, waiting between tries.
 * @param {string} incrementId the order number
 * @param {{ attempts?: number, wait?: () => Promise<void> }} [options]
 * @returns {Promise<string|null>} the token to release with, or null when it stayed taken
 */
export async function lockOrder(incrementId, options = {}) {
  return takeLock(await state(), lockKey(incrementId), options);
}

/** Release an order's invoice lock, only if this token still holds it. */
export async function unlockOrder(incrementId, token) {
  return releaseLock(await state(), lockKey(incrementId), token);
}
