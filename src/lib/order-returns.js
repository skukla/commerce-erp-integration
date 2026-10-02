/*
 * Returns and credit memos in App Builder State (returns-design.md §4), beside the order's parts
 * record (lib/order-parts.js), which they only read:
 *
 * - `order-returns-<return id>`: one record per Commerce return. Each ERP's piece: the return
 *   items it took, its status (sent, failed, received, credited), its return order number and
 *   the credit memos it made; and the items no ERP sold (unrouted), recorded and never sent.
 * - `order-credits-<order number>`: the ERP credit memos already made into Commerce credit
 *   memos, keyed `<ERP id>/<credit memo number>`, so a redelivered credit memo event credits
 *   nothing twice. Per order, not per return: an ERP can credit an invoice with no return.
 *   Its only writer is the credit memo handler, under the order's lock, so no other write can
 *   lose it — the parts record has writers that take no lock (router/part-outcomes.js).
 *
 * Every write to either record is made under the order's lock (lib/order-parts.js lockOrder).
 */
import stateLib from "@adobe/aio-lib-state";

const TTL_SECONDS = 365 * 24 * 60 * 60;
const RETURNS_PREFIX = "order-returns-";
const CREDITS_PREFIX = "order-credits-";

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetOrderReturnsClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

const keySafe = (id) => String(id).replace(/[^A-Za-z0-9_-]/gu, "_");

/** The State key of a return's record, by the return's entity id. */
export function orderReturnKey(returnId) {
  return `${RETURNS_PREFIX}${keySafe(returnId)}`;
}

/** The State key of an order's applied credit memos, by the order number a shopper sees. */
export function orderCreditsKey(incrementId) {
  return `${CREDITS_PREFIX}${keySafe(incrementId)}`;
}

async function readJson(key, empty) {
  const res = await (await state()).get(key);
  if (!res?.value) {
    return empty;
  }
  try {
    return { ...empty, ...JSON.parse(res.value) };
  } catch {
    return empty;
  }
}

async function writeJson(key, value) {
  await (await state()).put(key, JSON.stringify(value), { ttl: TTL_SECONDS });
}

/**
 * @param {number|string} returnId the return's entity id
 * @returns {Promise<{ pieces: object, unrouted: number[] }>}
 */
export function readOrderReturn(returnId) {
  return readJson(orderReturnKey(returnId), { pieces: {}, unrouted: [] });
}

/** Save a return's record whole. */
export function writeOrderReturn(returnId, record) {
  return writeJson(orderReturnKey(returnId), record);
}

/**
 * @param {string} incrementId the order number
 * @returns {Promise<{ applied: object }>}
 */
export function readOrderCredits(incrementId) {
  return readJson(orderCreditsKey(incrementId), { applied: {} });
}

/** Save an order's applied credit memos whole. */
export function writeOrderCredits(incrementId, record) {
  return writeJson(orderCreditsKey(incrementId), record);
}
