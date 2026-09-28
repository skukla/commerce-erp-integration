/** An in-memory stand-in for `@adobe/aio-lib-state`'s client: get, put, delete and a glob list. */
// biome-ignore-all lint/suspicious/useAwait: an in-memory state client answers promises without waiting on anything; the real client is async
const TRAILING_STAR = /\*$/u;

export function fakeState() {
  const store = new Map();
  return {
    async delete(key) {
      store.delete(key);
    },
    async get(key) {
      return store.has(key) ? { value: store.get(key) } : undefined;
    },
    /** aio-lib-state 5's list: pages of keys matching a glob; only a trailing `*` is used here. */
    async *list({ match }) {
      const prefix = match.replace(TRAILING_STAR, "");
      yield { keys: [...store.keys()].filter((k) => k.startsWith(prefix)) };
    },
    async put(key, value) {
      store.set(key, value);
      return key;
    },
    reset() {
      store.clear();
    },
    store,
  };
}
