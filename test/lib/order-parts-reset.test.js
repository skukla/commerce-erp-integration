/*
 * What a reset that closes orders needs of the per-order records (AB-16n): every order with a
 * parts record, a way to delete one, and a mark that says the reset closed an order.
 */
import {
  closedByReset,
  deleteOrderParts,
  listOrderPartsIds,
  markClosedByReset,
  resetOrderPartsClient,
  writeOrderParts,
} from "#lib/order-parts";

const TRAILING_STAR = /\*$/;

/** App Builder State, in memory: get, put, delete and a glob `list`, as aio-lib-state 5 has them. */
function memoryState() {
  const store = new Map();
  return {
    delete: (k) => Promise.resolve(store.delete(k)),
    get: (k) =>
      Promise.resolve(store.has(k) ? { value: store.get(k) } : undefined),
    // A plain generator: `for await` walks it the same as the library's async one.
    *list({ match }) {
      const prefix = match.replace(TRAILING_STAR, "");
      yield { keys: [...store.keys()].filter((k) => k.startsWith(prefix)) };
    },
    put: (k, v) => {
      store.set(k, v);
      return Promise.resolve(k);
    },
    store,
  };
}

let state;
beforeEach(() => {
  state = memoryState();
  resetOrderPartsClient(state);
});
afterEach(() => resetOrderPartsClient());

describe("Given orders with parts records", () => {
  test("Then every order number with a record is listed, and nothing else in State is", async () => {
    await writeOrderParts("000000042", { parts: {} });
    await writeOrderParts("000000043", { parts: {} });
    state.store.set("order-invoice-lock-000000042", "{}");
    state.store.set("ledger", "[]");
    expect((await listOrderPartsIds()).sort()).toEqual([
      "000000042",
      "000000043",
    ]);
  });

  test("Then deleting a record answers whether there was one", async () => {
    await writeOrderParts("000000042", { parts: {} });
    expect(await deleteOrderParts("000000042")).toBe(true);
    expect(await deleteOrderParts("000000042")).toBe(false);
    expect(await listOrderPartsIds()).toEqual([]);
  });
});

describe("Given an order the reset closed", () => {
  test("Then the mark says so, with the day, and is not a parts record", async () => {
    expect(await closedByReset("000000042")).toBeNull();
    await markClosedByReset("000000042", "2026-09-28");
    expect(await closedByReset("000000042")).toEqual({ day: "2026-09-28" });
    expect(await closedByReset("000000043")).toBeNull();
    expect(await listOrderPartsIds()).toEqual([]);
  });
});
