/** An in-memory stand-in for `@adobe/aio-lib-state`'s client: get, put, delete. */
// biome-ignore-all lint/suspicious/useAwait: an in-memory state client answers promises without waiting on anything; the real client is async
export function fakeState() {
  const store = new Map();
  return {
    async delete(key) {
      store.delete(key);
    },
    async get(key) {
      return store.has(key) ? { value: store.get(key) } : undefined;
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
