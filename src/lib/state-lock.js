/*
 * A lease lock over App Builder State, so a read-modify-write of a shared State document is not
 * clobbered by a concurrent writer. State has no compare-and-set: a taker writes its own token
 * and reads it back, and whoever reads their own token holds it; a lock older than LOCK_MS is
 * treated as abandoned. Extracted from the order invoice lock (lib/order-parts.js) once the key
 * map needed the same guard (AB-16g): its map is one document written by both a whole-map fill
 * and event-driven per-customer pairing, and the two races last-writer-wins without this.
 *
 * BEST-EFFORT, NOT EXACT (review, 2026-09-30; AB-48). Two takers that both read "no holder"
 * before either has written can each put, then each read back its OWN token — A puts, A reads
 * A; B puts, B reads B — and both believe they hold the lock. The window is the get → put → get
 * gap, tens of milliseconds against State. It makes the common case safe (a fill and an event
 * handler seconds apart) and leaves the same-instant case open. Nothing here closes it: that
 * needs a compare-and-set State does not offer, or one writer. The tests drive an in-memory
 * client that never opens the window, so they prove the protocol, not the race. Read "the lock
 * holds" as "almost always", and keep the documents it guards re-derivable from their sources.
 *
 * The State client is passed in, so callers keep their own `stateLib.init()` and this stays
 * testable with an in-memory client.
 */

const LOCK_MS = 30_000;
const LOCK_TTL_SECONDS = 60;
const DEFAULT_ATTEMPTS = 10;
const DEFAULT_WAIT_MS = 500;

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
 * Take a lock, waiting between tries for a holder to finish.
 * @param {object} client an App Builder State client
 * @param {string} key the lock's own State key
 * @param {{ attempts?: number, wait?: () => Promise<void> }} [options]
 * @returns {Promise<string|null>} the token to release with, or null when it stayed taken
 */
export async function takeLock(client, key, options = {}) {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const wait =
    options.wait ?? (() => new Promise((r) => setTimeout(r, DEFAULT_WAIT_MS)));
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

/** Release a lock, only if this token still holds it. */
export async function releaseLock(client, key, token) {
  const held = await lockHolder(client, key);
  if (held?.token === token) {
    await client.delete(key);
  }
}

/**
 * Run `fn` while holding `key`, releasing it afterwards even if `fn` throws. Throws when the
 * lock stays taken for the whole wait, so the caller does not run its write unguarded.
 * @template T
 * @param {object} client an App Builder State client
 * @param {string} key the lock's own State key
 * @param {() => Promise<T>} fn the critical section
 * @param {{ attempts?: number, wait?: () => Promise<void> }} [options]
 * @returns {Promise<T>}
 */
export async function withStateLock(client, key, fn, options = {}) {
  const token = await takeLock(client, key, options);
  if (!token) {
    throw new Error(`could not take the lock "${key}"`);
  }
  try {
    return await fn();
  } finally {
    await releaseLock(client, key, token);
  }
}
