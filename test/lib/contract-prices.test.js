/*
 * ERP contract prices into each company's shared catalog (AB-26z). The ERP sends one
 * customer's WHOLE set of prices in force (contract version 6, contract.changed and
 * GET contracts/in-force), so applying it is a replace: rows the ERP wrote before and still
 * wants stay, changed rows are written, and rows no longer in force are deleted, or get back
 * the price they held before the ERP first wrote them. Only the SKUs this ERP owns.
 *
 * Commerce here is a map of tier-price rows; the ledger is the real one on memory state.
 */
// biome-ignore-all lint/suspicious/useAwait: the fake Commerce answers promises without waiting on anything; the real calls are async and callers await them
import {
  applyCustomerPrices,
  ownedByErp,
  publishErpPrices,
} from "#lib/contract-prices";
import * as ledger from "#lib/ledger";

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

const keyOf = (r) =>
  `${r.sku}|${r.customer_group}|${r.quantity}|${r.website_id}`;

/** Commerce's tier prices, and the calls the integration makes on them. */
function fakeTierPrices(rows = []) {
  const db = new Map(rows.map((r) => [keyOf(r), r]));
  const tierPrices = {
    db,
    deleteTierPrices: vi.fn(async (_p, prices) => {
      for (const r of prices) {
        db.delete(keyOf(r));
      }
    }),
    revertTierPrice: vi.fn(async (p, entry) => {
      const row = (v) => ({
        customer_group: entry.customerGroup,
        price: v.price,
        price_type: v.priceType,
        quantity: entry.quantity,
        sku: entry.id,
        website_id: entry.websiteId,
      });
      return entry.before
        ? tierPrices.writeTierPrices(p, [row(entry.before)])
        : tierPrices.deleteTierPrices(p, [row(entry.after)]);
    }),
    sharedCatalogGroupOf: vi.fn(async (_p, companyId) =>
      companyId === "21"
        ? { customerGroup: "Kukla Studios", customerGroupId: 19 }
        : { skip: `company ${companyId} has no custom shared catalog` },
    ),
    tierPricesOf: vi.fn(async (_p, skus) =>
      [...db.values()].filter((r) => skus.includes(r.sku)),
    ),
    writeTierPrices: vi.fn(async (_p, prices) => {
      for (const r of prices) {
        db.set(keyOf(r), { ...r });
      }
    }),
  };
  return tierPrices;
}

function depsWith(tierPrices, { owns = () => true } = {}) {
  return {
    commerceCompanyOf: vi.fn(
      async (partnerId) => ({ C19: "20", C21: "21" })[partnerId] ?? null,
    ),
    ledger,
    ownsSku: vi.fn(async (sku) => owns(sku)),
    tierPrices,
  };
}

const price = (sku, value, minQty = 1) => ({
  contractNumber: "K-1",
  kind: "price",
  minQty,
  price: value,
  sku,
});
const row = (sku, value, extra = {}) => ({
  customer_group: "Kukla Studios",
  price: value,
  price_type: "fixed",
  quantity: 1,
  sku,
  website_id: 0,
  ...extra,
});

beforeEach(() => {
  ledger.resetLedgerClient(memoryState());
});

describe("Given one customer's prices in force", () => {
  test("Then a price line becomes a fixed tier price and a discount line a percentage one, at the line's minimum quantity, on every website", async () => {
    const tp = fakeTierPrices();
    const result = await applyCustomerPrices(
      {},
      {
        erpId: "erp",
        lines: [
          price("accessmesh", 40),
          {
            contractNumber: "K-1",
            kind: "discount",
            minQty: 10,
            percent: 12.5,
            sku: "rackmount",
          },
        ],
        partnerId: "C21",
      },
      depsWith(tp),
    );
    expect(tp.writeTierPrices).toHaveBeenCalledWith({}, [
      row("accessmesh", 40),
      row("rackmount", 12.5, { price_type: "discount", quantity: 10 }),
    ]);
    expect(result).toEqual({ removed: 0, unchanged: 0, written: 2 });
    expect((await ledger.readLedger()).map((e) => e.before)).toEqual([
      null,
      null,
    ]);
  });

  test("Then applying the same set again writes nothing (a replay is harmless)", async () => {
    const tp = fakeTierPrices();
    const deps = depsWith(tp);
    const customer = {
      erpId: "erp",
      lines: [price("accessmesh", 40)],
      partnerId: "C21",
    };
    await applyCustomerPrices({}, customer, deps);
    tp.writeTierPrices.mockClear();
    const again = await applyCustomerPrices({}, customer, deps);
    expect(tp.writeTierPrices).not.toHaveBeenCalled();
    expect(again).toEqual({ removed: 0, unchanged: 1, written: 0 });
  });

  test("Then a changed price is rewritten, a withdrawn one deleted, and a row that held a price before gets it back", async () => {
    // The SC had set 45 on rackmount in the catalog before the ERP priced it.
    const tp = fakeTierPrices([row("rackmount", 45)]);
    const deps = depsWith(tp);
    await applyCustomerPrices(
      {},
      {
        erpId: "erp",
        lines: [price("accessmesh", 40), price("rackmount", 30)],
        partnerId: "C21",
      },
      deps,
    );
    expect(tp.db.get("rackmount|Kukla Studios|1|0").price).toBe(30);
    const result = await applyCustomerPrices(
      {},
      { erpId: "erp", lines: [price("accessmesh", 38)], partnerId: "C21" },
      deps,
    );
    expect(result).toEqual({ removed: 1, unchanged: 0, written: 1 });
    expect([...tp.db.values()]).toEqual([
      row("rackmount", 45),
      row("accessmesh", 38),
    ]);
    // An empty set: nothing of the ERP's is left, and the ledger holds nothing.
    await applyCustomerPrices(
      {},
      { erpId: "erp", lines: [], partnerId: "C21" },
      deps,
    );
    expect([...tp.db.values()]).toEqual([row("rackmount", 45)]);
    expect(await ledger.readLedger()).toEqual([]);
  });

  test("Then only the SKUs this ERP owns are written", async () => {
    const tp = fakeTierPrices();
    const result = await applyCustomerPrices(
      {},
      {
        erpId: "acme",
        lines: [price("accessmesh", 40), price("other", 9)],
        partnerId: "C21",
      },
      depsWith(tp, { owns: (sku) => sku === "accessmesh" }),
    );
    expect(tp.writeTierPrices).toHaveBeenCalledWith({}, [
      row("accessmesh", 40),
    ]);
    expect(result).toEqual({
      notOwned: ["other"],
      removed: 0,
      unchanged: 0,
      written: 1,
    });
    expect((await ledger.readLedger())[0]).toMatchObject({
      companyId: "21",
      erpId: "acme",
      partnerId: "C21",
    });
  });

  test("Then a partner with no Commerce company, or a company with no shared catalog, is a skip with the reason", async () => {
    const tp = fakeTierPrices();
    const deps = depsWith(tp);
    expect(
      await applyCustomerPrices(
        {},
        { erpId: "erp", lines: [price("a", 1)], partnerId: "C404" },
        deps,
      ),
    ).toEqual({
      removed: 0,
      skipped: "partner C404 is paired with no Commerce company",
      unchanged: 0,
      written: 0,
    });
    expect(
      await applyCustomerPrices(
        {},
        { erpId: "erp", lines: [price("a", 1)], partnerId: "C19" },
        deps,
      ),
    ).toMatchObject({ skipped: "company 20 has no custom shared catalog" });
    expect(tp.writeTierPrices).not.toHaveBeenCalled();
  });

  // Commerce's storage call answers the rows it refused and saves the rest, so a refusal
  // must not leave the rows that did land out of the ledger: they could never be undone.
  test("Then when Commerce refuses part of a write, the rows that landed are still ledgered", async () => {
    const tp = fakeTierPrices();
    tp.writeTierPrices.mockImplementationOnce(async (_p, prices) => {
      tp.db.set(keyOf(prices[0]), { ...prices[0] });
      throw new Error("Commerce refused 1 tier price(s): nope");
    });
    await expect(
      applyCustomerPrices(
        {},
        {
          erpId: "erp",
          lines: [price("accessmesh", 40), price("bad", 1)],
          partnerId: "C21",
        },
        depsWith(tp),
      ),
    ).rejects.toThrow("refused");
    expect((await ledger.readLedger()).map((e) => e.id)).toEqual([
      "accessmesh",
    ]);
  });
});

describe("Given every customer's prices in force for one ERP", () => {
  test("Then each is applied, and a customer the ERP no longer lists loses what the ERP wrote for it", async () => {
    const tp = fakeTierPrices();
    const deps = depsWith(tp);
    const erp = { id: "erp" };
    await publishErpPrices(
      {},
      erp,
      [{ lines: [price("accessmesh", 40)], partnerId: "C21" }],
      deps,
    );
    expect(tp.db.size).toBe(1);
    const result = await publishErpPrices(
      {},
      erp,
      [{ lines: [price("x", 1)], partnerId: "C19" }],
      deps,
    );
    expect(tp.db.size).toBe(0);
    expect(result).toEqual({
      failed: [],
      removed: 1,
      skipped: [
        {
          erpId: "erp",
          partnerId: "C19",
          reason: "company 20 has no custom shared catalog",
        },
      ],
      unchanged: 0,
      written: 0,
    });
  });

  test("Then one customer failing does not stop the others, and is reported", async () => {
    const tp = fakeTierPrices();
    tp.sharedCatalogGroupOf.mockRejectedValueOnce(new Error("timeout"));
    const result = await publishErpPrices(
      {},
      { id: "erp" },
      [
        { lines: [price("a", 1)], partnerId: "C21" },
        { lines: [price("accessmesh", 40)], partnerId: "C21" },
      ],
      depsWith(tp),
    );
    expect(result.failed).toEqual([
      { erpId: "erp", error: "timeout", partnerId: "C21" },
    ]);
    expect(result.written).toBe(1);
  });
});

describe("Given which ERP owns a SKU", () => {
  test("Then one ERP owns everything, and with several a SKU is an ERP's only when it alone owns it", async () => {
    const readers = { productAttributes: vi.fn(), sourceCodesOf: vi.fn() };
    const one = ownedByErp({}, [{ id: "erp" }], "erp", readers);
    expect(await one("anything")).toBe(true);
    expect(readers.productAttributes).not.toHaveBeenCalled();
    readers.productAttributes.mockImplementation(async (_p, sku) => ({
      erp_owner: sku.startsWith("A") ? "acme" : "globex",
    }));
    const several = [{ id: "acme" }, { id: "globex" }];
    const acme = ownedByErp({}, several, "acme", readers);
    expect(await acme("A1")).toBe(true);
    expect(await acme("B1")).toBe(false);
  });
});
