/** An in-memory stand-in for `@adobe/aio-lib-state`'s client: get, put, delete and a glob list. */
// biome-ignore-all lint/suspicious/useAwait: an in-memory state client answers promises without waiting on anything; the real client is async
const TRAILING_STAR = /\*$/u;
/** aio-lib-state's key alphabet (lib/constants.js REGEX_PATTERN_STORE_KEY): it refuses any other key. */
const STORE_KEY = /^[a-zA-Z0-9-_.]{1,1024}$/u;

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
      if (!STORE_KEY.test(key)) {
        throw new Error(`invalid key ${key}`);
      }
      store.set(key, value);
      return key;
    },
    reset() {
      store.clear();
    },
    store,
  };
}
