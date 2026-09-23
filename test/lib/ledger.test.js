import {
  readLedger,
  recordCompanyWrite,
  recordProductWrite,
  resetLedgerClient,
  revertLedger,
} from "#lib/ledger";

function memoryState() {
  const store = new Map();
  return {
    delete: vi.fn((k) => Promise.resolve(store.delete(k))),
    get: vi.fn((k) =>
      Promise.resolve(store.has(k) ? { value: store.get(k) } : undefined),
    ),
    put: vi.fn((k, v, opts) => {
      store.set(k, v);
      return Promise.resolve(opts);
    }),
  };
}

describe("Given the company ledger", () => {
  let state;
  beforeEach(() => {
    state = memoryState();
    resetLedgerClient(state);
  });
  test("Then the first write keeps its before and later writes only move after", async () => {
    await recordCompanyWrite({
      after: 500,
      before: 1000,
      companyId: 7,
      field: "creditLimit",
    });
    await recordCompanyWrite({
      after: 200,
      before: 500,
      companyId: 7,
      field: "creditLimit",
    });
    const [entry] = await readLedger();
    // `id` + `kind` since products joined the ledger; a company entry is one kind of entry.
    expect(entry).toMatchObject({
      after: 200,
      before: 1000,
      field: "creditLimit",
      id: "7",
      kind: "company",
    });
    expect(state.put.mock.calls[0][2]).toEqual({ ttl: 31_536_000 });
  });
  test("Then revert writes every before through the writers and clears the ledger", async () => {
    await recordCompanyWrite({
      after: 500,
      before: 1000,
      companyId: 7,
      extra: { creditId: 42 },
      field: "creditLimit",
    });
    await recordCompanyWrite({
      after: 3,
      before: 1,
      companyId: 8,
      field: "status",
    });
    const writers = {
      creditLimit: vi.fn(async () => true),
      status: vi.fn(async () => true),
    };
    const result = await revertLedger(writers);
    expect(writers.creditLimit).toHaveBeenCalledWith("7", 42, 1000);
    expect(writers.status).toHaveBeenCalledWith("8", 1);
    expect(result).toEqual({ failed: [], reverted: 2 });
    expect(await readLedger()).toEqual([]);
  });
  test("Then a failed revert keeps only the failed entries", async () => {
    await recordCompanyWrite({
      after: 500,
      before: 1000,
      companyId: 7,
      field: "creditLimit",
    });
    await recordCompanyWrite({
      after: 3,
      before: 1,
      companyId: 8,
      field: "status",
    });
    const writers = {
      creditLimit: vi.fn(() => Promise.reject(new Error("nope"))),
      status: vi.fn(async () => true),
    };
    const result = await revertLedger(writers);
    expect(result.reverted).toBe(1);
    expect(result.failed).toEqual([
      { error: "nope", field: "creditLimit", id: "7" },
    ]);
    expect((await readLedger()).map((e) => e.id)).toEqual(["7"]);
  });
});

/*
 * Commerce is the demonstrator's permanent system and the ERP is transient (owner,
 * 2026-09-23), so anything the ERP writes into Commerce that Commerce can undo must be
 * put back when the integration goes. Company credit and blocks were ledgered from the
 * start; prices and stock were not, so a demo left the ERP's prices behind in the store.
 */
describe("Given the ERP writing a product's price or stock into Commerce", () => {
  let state;
  beforeEach(() => {
    state = memoryState();
    resetLedgerClient(state);
  });

  test("Then the price Commerce had before the ERP ever touched it is what is kept", async () => {
    await recordProductWrite({
      after: 89,
      before: 120,
      field: "price",
      sku: "CS-ROUTER-11",
    });
    await recordProductWrite({
      after: 79,
      before: 89,
      field: "price",
      sku: "CS-ROUTER-11",
    });

    expect(await readLedger()).toMatchObject([
      {
        after: 79,
        before: 120,
        field: "price",
        id: "CS-ROUTER-11",
        kind: "product",
      },
    ]);
  });

  // Stock is per source, so two sources of one SKU are two different writes.
  test("Then each source's stock is its own entry", async () => {
    await recordProductWrite({
      after: 4,
      before: 10,
      extra: { source: "east" },
      field: "stock",
      sku: "A1",
    });
    await recordProductWrite({
      after: 7,
      before: 2,
      extra: { source: "west" },
      field: "stock",
      sku: "A1",
    });

    expect(
      (await readLedger()).map((e) => [e.id, e.source, e.before]),
    ).toStrictEqual([
      ["A1", "east", 10],
      ["A1", "west", 2],
    ]);
  });

  test("Then reverting puts each one back, by kind", async () => {
    await recordCompanyWrite({
      after: 500,
      before: 100,
      companyId: 7,
      extra: { creditId: 9 },
      field: "creditLimit",
    });
    await recordProductWrite({
      after: 89,
      before: 120,
      field: "price",
      sku: "A1",
    });
    await recordProductWrite({
      after: 4,
      before: 10,
      extra: { source: "east" },
      field: "stock",
      sku: "A1",
    });
    const writers = {
      creditLimit: vi.fn(),
      price: vi.fn(),
      status: vi.fn(),
      stock: vi.fn(),
    };

    const result = await revertLedger(writers);

    expect(result).toMatchObject({ failed: [], reverted: 3 });
    expect(writers.price).toHaveBeenCalledWith("A1", 120);
    expect(writers.stock).toHaveBeenCalledWith("A1", "east", 10);
    expect(writers.creditLimit).toHaveBeenCalledWith("7", 9, 100);
    expect(await readLedger()).toStrictEqual([]);
  });

  test("Then one failed revert keeps its own entry and no other", async () => {
    await recordProductWrite({
      after: 89,
      before: 120,
      field: "price",
      sku: "A1",
    });
    await recordProductWrite({
      after: 4,
      before: 10,
      extra: { source: "east" },
      field: "stock",
      sku: "A1",
    });
    const writers = {
      creditLimit: vi.fn(),
      price: vi.fn(() => {
        throw new Error("product not found");
      }),
      status: vi.fn(),
      stock: vi.fn(),
    };

    const result = await revertLedger(writers);

    expect(result.reverted).toBe(1);
    expect(result.failed).toMatchObject([{ field: "price", id: "A1" }]);
    expect((await readLedger()).map((e) => e.field)).toStrictEqual(["price"]);
  });

  // A project that was writing company entries before products were ledgered has entries
  // with no `kind`. They are company entries and must still revert.
  test("Then an entry saved before products were ledgered still reverts as a company", async () => {
    state.put(
      "erp-company-ledger",
      JSON.stringify([
        {
          after: 500,
          before: 100,
          companyId: "7",
          creditId: 9,
          field: "creditLimit",
        },
      ]),
    );
    const writers = {
      creditLimit: vi.fn(),
      price: vi.fn(),
      status: vi.fn(),
      stock: vi.fn(),
    };

    const result = await revertLedger(writers);

    expect(writers.creditLimit).toHaveBeenCalledWith("7", 9, 100);
    expect(result.reverted).toBe(1);
  });
});
