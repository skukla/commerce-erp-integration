/*
 * The parts of each routed order (design v1 §3.3): which ERP owns which of its lines, what
 * happened to each part, and the lines no ERP (or two ERPs) claimed. One record per order in
 * App Builder State, like the write ledger (lib/ledger.js) and the key map (lib/key-map.js).
 *
 * A part is keyed by the order and the ERP's id, so a redelivered order event finds the parts
 * already sent and sends them again never.
 */
import stateLib from "@adobe/aio-lib-state";

const TTL_SECONDS = 365 * 24 * 60 * 60;

/** The outcomes after which a part is never sent again. */
export const FINAL_OUTCOMES = Object.freeze(["sent", "skipped", "dropped"]);

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

/** The State key of an order's parts, by the order number a shopper sees. */
export function orderPartsKey(incrementId) {
  return `order-parts-${String(incrementId).replace(/[^A-Za-z0-9_-]/gu, "_")}`;
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
