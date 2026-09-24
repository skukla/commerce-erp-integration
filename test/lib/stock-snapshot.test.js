import {
  noteWritten,
  readSnapshot,
  resetSnapshotClient,
  slot,
  writeSnapshot,
} from "#lib/stock-snapshot";

function fakeState() {
  const store = new Map();
  return {
    get: vi.fn((key) =>
      Promise.resolve(store.has(key) ? { value: store.get(key) } : undefined),
    ),
    put: vi.fn((key, value) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    store,
  };
}

describe("Given the stock snapshot", () => {
  let state;
  beforeEach(() => {
    state = fakeState();
    resetSnapshotClient(state);
  });
  afterEach(() => resetSnapshotClient());

  test("Then nothing read yet is null, not an empty map, so the first refresh knows to seed", async () => {
    expect(await readSnapshot()).toBeNull();
    state.store.set("erp-stock-snapshot", "not json");
    expect(await readSnapshot()).toBeNull();
  });
  test("Then a write is read back, under one key with a year's life", async () => {
    await writeSnapshot({ [slot("A1", "east")]: 4 });
    expect(await readSnapshot()).toEqual({ "A1|east": 4 });
    expect(state.put).toHaveBeenCalledWith(
      "erp-stock-snapshot",
      '{"A1|east":4}',
      { ttl: 365 * 24 * 60 * 60 },
    );
  });
  test("Then what the ERP wrote into Commerce is noted, so the refresh does not echo it; before the first read nothing is noted", async () => {
    await noteWritten([{ quantity: 9, sku: "A1", source_code: "east" }]);
    expect(await readSnapshot()).toBeNull();
    await writeSnapshot({ "A1|east": 4, "B2|default": 1 });
    await noteWritten([{ quantity: 9, sku: "A1", source_code: "east" }]);
    expect(await readSnapshot()).toEqual({ "A1|east": 9, "B2|default": 1 });
  });
});
