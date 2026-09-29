/*
 * The key map: which Commerce record is which ERP record. Loaded whole by Demo Builder after
 * each fill (a go-live key-map load), read by the order sender and the cart price webhook.
 */
import {
  commerceCompanyOf,
  erpCustomerOf,
  keyMapProblem,
  LOCK_KEY,
  pairCustomer,
  readKeyMap,
  replaceKeyMap,
  resetKeyMapClient,
} from "#lib/key-map";
import { releaseLock, takeLock } from "#lib/state-lock";

const NO_WAIT = () => Promise.resolve();
const FAST = { attempts: 1, wait: NO_WAIT };
const LOCK_HELD = /could not take the lock/u;

function memoryState() {
  const store = new Map();
  return {
    delete: vi.fn((k) => {
      store.delete(k);
      return Promise.resolve();
    }),
    get: vi.fn((k) =>
      Promise.resolve(store.has(k) ? { value: store.get(k) } : undefined),
    ),
    put: vi.fn((k, v, opts) => {
      store.set(k, v);
      return Promise.resolve(opts);
    }),
  };
}

const MAP = [
  { commerce: "12", erp: "C000102", kind: "customer" },
  { commerce: "21", erp: "C000103", kind: "customer" },
];

beforeEach(() => {
  resetKeyMapClient(memoryState());
});

describe("Given an empty key map", () => {
  test("Then it reads as no rows and finds nobody", async () => {
    expect(await readKeyMap()).toEqual([]);
    expect(await erpCustomerOf("12")).toBeNull();
    expect(await commerceCompanyOf("C000102")).toBeNull();
  });
});

describe("Given a key map loaded by Demo Builder", () => {
  test("Then each side finds the other", async () => {
    await replaceKeyMap(MAP);
    expect(await erpCustomerOf("12")).toBe("C000102");
    expect(await erpCustomerOf(21)).toBe("C000103");
    expect(await commerceCompanyOf("C000103")).toBe("21");
    expect(await erpCustomerOf("99")).toBeNull();
  });

  test("Then a second load replaces the first whole", async () => {
    await replaceKeyMap(MAP);
    await replaceKeyMap([{ commerce: "30", erp: "C000200", kind: "customer" }]);
    expect(await readKeyMap()).toEqual([
      { commerce: "30", erp: "C000200", kind: "customer" },
    ]);
    expect(await erpCustomerOf("12")).toBeNull();
  });

  test("Then pairing a new customer adds one row, and pairing it again moves it", async () => {
    await replaceKeyMap(MAP);
    await pairCustomer("40", "C000300");
    expect(await erpCustomerOf("40")).toBe("C000300");
    await pairCustomer("40", "C000301");
    expect(await erpCustomerOf("40")).toBe("C000301");
    expect(await readKeyMap()).toHaveLength(3);
  });
});

describe("Given a fill in progress (the key-map lock is held)", () => {
  const A = { commerce: "12", erp: "C000102", kind: "customer" };

  test("Then a concurrent pairing does not clobber the map with a stale copy (AB-16g)", async () => {
    const client = memoryState();
    resetKeyMapClient(client);
    await replaceKeyMap([A], FAST);

    // A fill holds the lock; the pairing cannot take it, so it refuses rather than
    // read the pre-fill map and write it back, dropping the fill's rows.
    const held = await takeLock(client, LOCK_KEY, FAST);
    expect(held).toEqual(expect.any(String));
    await expect(
      pairCustomer("40", "C000300", undefined, FAST),
    ).rejects.toThrow(LOCK_HELD);
    expect(await readKeyMap()).toEqual([A]);

    // Once the fill releases, the pairing runs and keeps the existing pair.
    await releaseLock(client, LOCK_KEY, held);
    await pairCustomer("40", "C000300", undefined, FAST);
    const map = await readKeyMap();
    expect(map).toContainEqual(A);
    expect(map.some((e) => e.erp === "C000300")).toBe(true);
  });
});

describe("Given a key map to check before it is saved", () => {
  test("Then a well-formed map has no problem", () => {
    expect(keyMapProblem(MAP)).toBeNull();
    expect(keyMapProblem([])).toBeNull();
  });

  test.each([
    ["not a list", { rows: MAP }, "entries is a list"],
    [
      "an unknown kind",
      [{ commerce: "1", erp: "C1", kind: "product" }],
      "kind",
    ],
    [
      "a Commerce id that is not a number",
      [{ commerce: "x", erp: "C1", kind: "customer" }],
      "commerce",
    ],
    [
      "an empty ERP number",
      [{ commerce: "1", erp: "", kind: "customer" }],
      "erp",
    ],
    [
      "one Commerce record paired twice",
      [
        { commerce: "1", erp: "C1", kind: "customer" },
        { commerce: "1", erp: "C2", kind: "customer" },
      ],
      "twice",
    ],
    [
      "one ERP record paired twice",
      [
        { commerce: "1", erp: "C1", kind: "customer" },
        { commerce: "2", erp: "C1", kind: "customer" },
      ],
      "twice",
    ],
  ])("Then %s is refused", (_label, entries, words) => {
    expect(keyMapProblem(entries)).toContain(words);
  });
});
