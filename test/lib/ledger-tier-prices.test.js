/*
 * ERP contract prices written into a company's shared catalog (AB-26z) are tier prices, and
 * whatever the integration writes into Commerce it must be able to take back out. A tier
 * price is one row per SKU, customer group, quantity and website; the ledger keeps what
 * that row held before the ERP first wrote it (usually nothing), and revert deletes the row
 * or puts the old price back.
 */
import {
  forgetTierPrice,
  readLedger,
  recordProductWrite,
  recordTierPriceWrite,
  resetLedgerClient,
  revertLedger,
  tierPriceEntries,
} from "#lib/ledger";

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

const ROW = {
  companyId: "21",
  customerGroup: "Example Studios",
  erpId: "erp",
  partnerId: "C21",
  quantity: 1,
  sku: "accessmesh",
  websiteId: 0,
};

beforeEach(() => {
  resetLedgerClient(memoryState());
});

describe("Given the ERP writing a tier price into a company's shared catalog", () => {
  test("Then the first write keeps what the row held before, and later writes move only after", async () => {
    await recordTierPriceWrite({
      ...ROW,
      after: { price: 40, priceType: "fixed" },
      before: null,
    });
    await recordTierPriceWrite({
      ...ROW,
      after: { price: 38, priceType: "fixed" },
      before: { price: 40, priceType: "fixed" },
    });
    expect(await readLedger()).toMatchObject([
      {
        after: { price: 38, priceType: "fixed" },
        before: null,
        customerGroup: "Example Studios",
        erpId: "erp",
        field: "tierPrice",
        id: "accessmesh",
        kind: "tierPrice",
        partnerId: "C21",
        quantity: 1,
        websiteId: 0,
      },
    ]);
  });

  test("Then another quantity or another group is another row", async () => {
    await recordTierPriceWrite({ ...ROW, after: { price: 40 }, before: null });
    await recordTierPriceWrite({
      ...ROW,
      after: { price: 35 },
      before: null,
      quantity: 10,
    });
    await recordTierPriceWrite({
      ...ROW,
      after: { price: 45 },
      before: null,
      customerGroup: "Other",
    });
    expect(await readLedger()).toHaveLength(3);
  });

  test("Then an ERP's rows for one customer can be listed and one forgotten", async () => {
    await recordTierPriceWrite({ ...ROW, after: { price: 40 }, before: null });
    await recordTierPriceWrite({
      ...ROW,
      after: { price: 9 },
      before: null,
      erpId: "acme",
      sku: "B2",
    });
    await recordProductWrite({
      after: 12,
      before: 10,
      field: "price",
      sku: "accessmesh",
    });
    const mine = await tierPriceEntries({ erpId: "erp", partnerId: "C21" });
    expect(mine.map((e) => e.id)).toEqual(["accessmesh"]);
    expect(await tierPriceEntries({ erpId: "erp" })).toHaveLength(1);
    await forgetTierPrice(mine[0]);
    expect((await readLedger()).map((e) => [e.kind, e.id])).toEqual([
      ["tierPrice", "B2"],
      ["product", "accessmesh"],
    ]);
  });

  test("Then revert hands each tier price to its writer, and a failed one keeps only itself", async () => {
    await recordTierPriceWrite({ ...ROW, after: { price: 40 }, before: null });
    await recordTierPriceWrite({
      ...ROW,
      after: { price: 45 },
      before: { price: 50, priceType: "fixed" },
      customerGroup: "Other",
    });
    const tierPrice = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("locked"));
    const result = await revertLedger({ tierPrice });
    expect(tierPrice).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        before: null,
        customerGroup: "Example Studios",
      }),
    );
    expect(result).toEqual({
      failed: [{ error: "locked", field: "tierPrice", id: "accessmesh" }],
      reverted: 1,
    });
    // Both rows share the SKU; only the failed one stays to be tried again.
    expect((await readLedger()).map((e) => e.customerGroup)).toEqual(["Other"]);
  });
});

/*
 * Detach is a web action: its answer is cut off at 60 seconds. One write at a time over a
 * demo's worth of prices outran it (Justrite, 2026-10-02: a reset stopped before its wipe).
 */
describe("Given a ledger holding the prices of many products", () => {
  const writeFor = async (sku, quantity) =>
    recordTierPriceWrite({
      ...ROW,
      after: { price: 10, priceType: "fixed" },
      before: null,
      quantity,
      sku,
    });

  test("Then revert undoes several products at a time, never more than its limit", async () => {
    for (let n = 0; n < 20; n += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the ledger is written in order
      await writeFor(`sku-${n}`, 1);
    }
    let running = 0;
    let most = 0;
    const tierPrice = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    });
    const result = await revertLedger({ tierPrice });
    expect(result).toEqual({ failed: [], reverted: 20 });
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(6);
    expect(await readLedger()).toEqual([]);
  });

  test("Then one product's rows are still undone one after another, in the order written", async () => {
    await writeFor("sku-a", 1);
    await writeFor("sku-a", 10);
    await writeFor("sku-b", 1);
    const seen = [];
    let runningA = 0;
    const tierPrice = vi.fn(async (entry) => {
      if (entry.id === "sku-a") {
        runningA += 1;
        expect(runningA).toBe(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(`${entry.id}/${entry.quantity}`);
      if (entry.id === "sku-a") {
        runningA -= 1;
      }
    });
    await revertLedger({ tierPrice });
    expect(seen.filter((s) => s.startsWith("sku-a"))).toEqual([
      "sku-a/1",
      "sku-a/10",
    ]);
    expect(seen).toHaveLength(3);
  });
});
