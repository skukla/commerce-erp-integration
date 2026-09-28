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

/*
 * One invoice at a time per order. Adobe's quality patch MDVA-40399 reports that two partial
 * invoices created at once on one order fail (reported, not re-verified), so every partial
 * invoice on an order is created under this lock. App Builder State has no compare-and-set:
 * a taker writes its own token and reads it back, and whoever reads their own token holds it.
 * A lock older than LOCK_MS is treated as abandoned.
 */
const LOCK_MS = 30_000;
const LOCK_TTL_SECONDS = 60;

function lockKey(incrementId) {
  return `order-invoice-lock-${String(incrementId).replace(/[^A-Za-z0-9_-]/gu, "_")}`;
}

async function lockHolder(client, key) {
  const res = await client.get(key);
  if (!res?.value) {
    return null;
  }
  try {
    const held = JSON.parse(res.value);
    return held.until > Date.now() ? held : null;
  } catch {
    return null;
  }
}

/**
 * Take an order's invoice lock, waiting between tries.
 * @param {string} incrementId the order number
 * @param {{ attempts?: number, wait?: () => Promise<void> }} [options]
 * @returns {Promise<string|null>} the token to release with, or null when it stayed taken
 */
export async function lockOrder(incrementId, options = {}) {
  const client = await state();
  const key = lockKey(incrementId);
  const attempts = options.attempts ?? 10;
  const wait = options.wait ?? (() => new Promise((r) => setTimeout(r, 500)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each try waits for the holder to finish
    if (!(await lockHolder(client, key))) {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await client.put(
        key,
        JSON.stringify({ token, until: Date.now() + LOCK_MS }),
        {
          ttl: LOCK_TTL_SECONDS,
        },
      );
      const held = await lockHolder(client, key);
      if (held?.token === token) {
        return token;
      }
    }
    await wait();
  }
  return null;
}

/** Release an order's invoice lock, only if this token still holds it. */
export async function unlockOrder(incrementId, token) {
  const client = await state();
  const key = lockKey(incrementId);
  const held = await lockHolder(client, key);
  if (held?.token === token) {
    await client.delete(key);
  }
}
