import {
  readLedger,
  recordCompanyWrite,
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
    expect(entry).toMatchObject({
      after: 200,
      before: 1000,
      companyId: "7",
      field: "creditLimit",
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
      { companyId: "7", error: "nope", field: "creditLimit" },
    ]);
    expect((await readLedger()).map((e) => e.companyId)).toEqual(["7"]);
  });
});
