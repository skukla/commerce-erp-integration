/*
 * Resetting one ERP (AB-16c): every ledger write names the ERP that made it, so one ERP's
 * writes can be undone and the others' left. An entry that names none is the first ERP's
 * (`erp`), the rule the key map uses. Company credit is SHARED between ERPs (one attribute set,
 * one total), so its entries list every ERP that wrote them and are left to detach, which
 * rebuilds them from what the other ERPs still hold.
 */
import {
  forgetCompanyErp,
  readLedger,
  recordCompanyWrite,
  recordProductWrite,
  recordTierPriceWrite,
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

let state;
beforeEach(() => {
  state = memoryState();
  resetLedgerClient(state);
});

const writers = () => ({
  creditLimit: vi.fn(),
  customAttributes: vi.fn(),
  name: vi.fn(),
  price: vi.fn(),
  status: vi.fn(),
  stock: vi.fn(),
  tierPrice: vi.fn(),
});

describe("Given writes from two ERPs", () => {
  test("Then a product entry names the ERP whose value Commerce now holds", async () => {
    await recordProductWrite({
      after: 89,
      before: 120,
      erpId: "northwind",
      field: "price",
      sku: "A1",
    });
    await recordProductWrite({
      after: 79,
      before: 89,
      erpId: "contoso",
      field: "price",
      sku: "A1",
    });
    expect(await readLedger()).toMatchObject([
      { after: 79, before: 120, erpId: "contoso", field: "price", id: "A1" },
    ]);
  });

  test("Then a company entry lists every ERP that wrote the shared value, once each", async () => {
    for (const erpId of ["northwind", "contoso", "northwind"]) {
      // biome-ignore lint/performance/noAwaitInLoops: one ledger document, in order
      await recordCompanyWrite({
        after: 1,
        before: 0,
        companyId: 7,
        erpId,
        field: "creditLimit",
      });
    }
    expect(await readLedger()).toMatchObject([
      { erpIds: ["northwind", "contoso"], field: "creditLimit", id: "7" },
    ]);
  });

  test("Then reverting one ERP puts back only its products and tier prices, and keeps the rest", async () => {
    await recordProductWrite({
      after: 4,
      before: 10,
      erpId: "contoso",
      extra: { source: "east" },
      field: "stock",
      sku: "B1",
    });
    await recordProductWrite({
      after: 89,
      before: 120,
      erpId: "northwind",
      field: "price",
      sku: "A1",
    });
    await recordTierPriceWrite({
      after: { price: 5, priceType: "fixed" },
      before: null,
      customerGroup: "G",
      erpId: "contoso",
      quantity: 1,
      sku: "B1",
      websiteId: 0,
    });
    await recordCompanyWrite({
      after: 500,
      before: 100,
      companyId: 7,
      erpId: "contoso",
      extra: { creditId: 9 },
      field: "creditLimit",
    });
    const w = writers();

    const result = await revertLedger(w, "contoso");

    expect(result).toEqual({ failed: [], reverted: 2 });
    expect(w.stock).toHaveBeenCalledWith("B1", "east", 10);
    expect(w.tierPrice).toHaveBeenCalledTimes(1);
    expect(w.price).not.toHaveBeenCalled();
    expect(w.creditLimit).not.toHaveBeenCalled();
    expect((await readLedger()).map((e) => [e.kind, e.id])).toEqual([
      ["product", "A1"],
      ["company", "7"],
    ]);
  });

  test("Then an entry that names no ERP is the first ERP's", async () => {
    await state.put(
      "erp-company-ledger",
      JSON.stringify([
        { after: 89, before: 120, field: "price", id: "A1", kind: "product" },
      ]),
    );
    const w = writers();

    expect(await revertLedger(w, "contoso")).toEqual({
      failed: [],
      reverted: 0,
    });
    expect(await revertLedger(w, "erp")).toEqual({ failed: [], reverted: 1 });
    expect(w.price).toHaveBeenCalledWith("A1", 120);
    expect(await readLedger()).toEqual([]);
  });

  test("Then one ERP's failed revert keeps its own entry beside the others'", async () => {
    await recordProductWrite({
      after: 89,
      before: 120,
      erpId: "contoso",
      field: "price",
      sku: "A1",
    });
    await recordProductWrite({
      after: 9,
      before: 12,
      erpId: "northwind",
      field: "price",
      sku: "B1",
    });
    const w = writers();
    w.price.mockRejectedValueOnce(new Error("locked"));

    const result = await revertLedger(w, "contoso");

    expect(result).toEqual({
      failed: [{ error: "locked", field: "price", id: "A1" }],
      reverted: 0,
    });
    expect((await readLedger()).map((e) => e.id)).toEqual(["A1", "B1"]);
  });
});

describe("Given a company whose credit two ERPs wrote", () => {
  beforeEach(async () => {
    for (const erpId of ["northwind", "contoso"]) {
      for (const field of ["customAttributes", "creditLimit"]) {
        // biome-ignore lint/performance/noAwaitInLoops: one ledger document, in order
        await recordCompanyWrite({
          after: 1,
          before: 0,
          companyId: 7,
          erpId,
          field,
        });
      }
    }
    await recordCompanyWrite({
      after: 1,
      before: 0,
      companyId: 8,
      erpId: "contoso",
      field: "creditLimit",
    });
  });

  test("Then forgetting one ERP there keeps the entries for the ERP still holding credit", async () => {
    await forgetCompanyErp("7", "contoso", { restored: false });
    expect((await readLedger()).map((e) => [e.id, e.field, e.erpIds])).toEqual([
      ["7", "customAttributes", ["northwind"]],
      ["7", "creditLimit", ["northwind"]],
      ["8", "creditLimit", ["contoso"]],
    ]);
  });

  test("Then once the company is back to what it had, its credit entries go", async () => {
    await forgetCompanyErp("7", "contoso", { restored: true });
    expect((await readLedger()).map((e) => [e.id, e.field])).toEqual([
      ["8", "creditLimit"],
    ]);
  });
});
