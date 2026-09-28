/*
 * The per-ERP credit attributes (design v1 §3.1) are a company write like any other: the
 * ledger keeps the set as it was before the first ERP write, and detach puts it back.
 */
import { detach } from "#lib/detach";
import {
  readLedger,
  recordCompanyWrite,
  resetLedgerClient,
  revertLedger,
} from "#lib/ledger";

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

beforeEach(() => {
  resetLedgerClient(memoryState());
});

describe("Given per-ERP credit attributes written to a company", () => {
  test("Then the revert writes back the set Commerce had before the first ERP write", async () => {
    const before = [{ attribute_code: "unrelated", value: "x" }];
    await recordCompanyWrite({
      after: [...before, { attribute_code: "erp_a_credit_limit", value: "1" }],
      before,
      companyId: "7",
      field: "customAttributes",
    });
    await recordCompanyWrite({
      after: [{ attribute_code: "erp_a_credit_limit", value: "2" }],
      before: [],
      companyId: "7",
      field: "customAttributes",
    });
    const writers = { customAttributes: vi.fn(async () => true) };
    expect(await revertLedger(writers)).toEqual({ failed: [], reverted: 1 });
    expect(writers.customAttributes).toHaveBeenCalledWith("7", before);
    expect(await readLedger()).toEqual([]);
  });

  test("Then detach hands the revert a writer for them", async () => {
    const commerce = { setCompanyCustomAttributes: vi.fn(async () => ({})) };
    const ledger = {
      revertLedger: vi.fn(async (writers) => {
        await writers.customAttributes("7", []);
        return { failed: [], reverted: 1 };
      }),
    };
    const erp = {
      listOrders: vi.fn(async () => ({
        data: { items: [] },
        ok: true,
        status: 200,
      })),
    };
    await detach({ p: 1 }, { commerce, erp, ledger });
    expect(commerce.setCompanyCustomAttributes).toHaveBeenCalledWith(
      { p: 1 },
      "7",
      [],
    );
  });
});
