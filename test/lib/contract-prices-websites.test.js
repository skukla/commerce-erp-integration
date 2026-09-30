/*
 * A price line scoped to a sales organization lands on THAT organization's websites only
 * (contract version 12, AB-46): one tier-price row per website the organization sells through,
 * never a row for every website. A shared catalog's tier prices carry a website (Adobe, B2B "Set
 * shared catalog pricing and structure"); a per-site discount on the wrong site was the defect.
 * Same fakes as contract-prices.test.js: Commerce is a map of tier-price rows, the ledger the
 * real one on memory state.
 */
// biome-ignore-all lint/suspicious/useAwait: the fake Commerce answers promises without waiting on anything
import { applyCustomerPrices } from "#lib/contract-prices";
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
    sharedCatalogGroupOf: vi.fn(async () => ({
      customerGroup: "Kukla Studios",
      customerGroupId: 19,
    })),
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

/** EU (2000) sells through websites 5 and 7; US (1000) through 1; nobody sells through 3000. */
const SITES = { 1000: [1], 2000: [5, 7] };

function depsWith(tierPrices, { websiteIdsOf } = {}) {
  return {
    commerceCompanyOf: vi.fn(async () => "21"),
    ledger,
    ownsSku: vi.fn(async () => true),
    tierPrices,
    websiteIdsOf,
  };
}

const withSites = vi.fn(async (org) => SITES[org] ?? []);
const customer = (lines) => ({ erpId: "erp", lines, partnerId: "C21" });
const eu = (sku, percent) => ({
  appliesTo: "customer",
  contractNumber: null,
  kind: "discount",
  minQty: 1,
  percent,
  salesOrg: "2000",
  sku,
});
const everywhere = (sku, value) => ({
  appliesTo: "customer",
  contractNumber: "K-1",
  kind: "price",
  minQty: 1,
  price: value,
  sku,
});
const row = (sku, website, extra = {}) => ({
  customer_group: "Kukla Studios",
  quantity: 1,
  sku,
  website_id: website,
  ...extra,
});

beforeEach(() => {
  ledger.resetLedgerClient(memoryState());
  withSites.mockClear();
});

describe("Given a line scoped to a sales organization", () => {
  test("Then it becomes one row per website that organization sells through, and none for every website", async () => {
    const tp = fakeTierPrices();
    const result = await applyCustomerPrices(
      {},
      customer([eu("A1", 10)]),
      depsWith(tp, { websiteIdsOf: withSites }),
    );
    expect(tp.writeTierPrices).toHaveBeenCalledWith({}, [
      row("A1", 5, { price: 10, price_type: "discount" }),
      row("A1", 7, { price: 10, price_type: "discount" }),
    ]);
    expect([...tp.db.values()].map((r) => r.website_id).sort()).toEqual([5, 7]);
    expect(result).toEqual({ removed: 0, unchanged: 0, written: 2 });
    // The ledger knows which website each row is on, so a later set can take it back.
    expect((await ledger.readLedger()).map((e) => e.websiteId).sort()).toEqual([5, 7]);
  });

  test("Then an unscoped line still goes to every website, beside the scoped ones", async () => {
    const tp = fakeTierPrices();
    await applyCustomerPrices(
      {},
      customer([everywhere("B2", 40), eu("A1", 10)]),
      depsWith(tp, { websiteIdsOf: withSites }),
    );
    expect([...tp.db.values()].map((r) => `${r.sku}@${r.website_id}`).sort()).toEqual([
      "A1@5",
      "A1@7",
      "B2@0",
    ]);
  });

  test("Then an organization that sells through no website here is left out and named — never published everywhere", async () => {
    const tp = fakeTierPrices();
    const result = await applyCustomerPrices(
      {},
      customer([{ ...eu("A1", 10), salesOrg: "3000" }]),
      depsWith(tp, { websiteIdsOf: withSites }),
    );
    expect(tp.writeTierPrices).not.toHaveBeenCalled();
    expect(result).toEqual({
      removed: 0,
      unchanged: 0,
      unmapped: ["A1 (sales organization 3000)"],
      written: 0,
    });
  });

  test("Then without a resolver a scoped line maps to no website (safe), and the unscoped one still lands", async () => {
    const tp = fakeTierPrices();
    const result = await applyCustomerPrices(
      {},
      customer([eu("A1", 10), everywhere("B2", 40)]),
      depsWith(tp),
    );
    expect([...tp.db.values()].map((r) => `${r.sku}@${r.website_id}`)).toEqual(["B2@0"]);
    expect(result.unmapped).toEqual(["A1 (sales organization 2000)"]);
  });

  test("Then the next set without the scoped line takes its website rows back, and a replay writes nothing", async () => {
    const tp = fakeTierPrices();
    const deps = depsWith(tp, { websiteIdsOf: withSites });
    await applyCustomerPrices({}, customer([eu("A1", 10)]), deps);
    const again = await applyCustomerPrices({}, customer([eu("A1", 10)]), deps);
    expect(again).toEqual({ removed: 0, unchanged: 2, written: 0 });
    const gone = await applyCustomerPrices({}, customer([]), deps);
    expect(gone.removed).toBe(2);
    expect(tp.db.size).toBe(0);
  });
});
