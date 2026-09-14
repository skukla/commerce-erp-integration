import { applyEntry, drain } from "#lib/drain";

const STATUS_503 = /503/u;

function fakeCommerce() {
  return {
    COMPANY_STATUS: { APPROVED: 1, BLOCKED: 3 },
    getCompany: vi.fn(async () => ({ id: 7, status: 1 })),
    getCompanyCredit: vi.fn(async () => ({ credit_limit: 1000, id: 42 })),
    orders: {
      cancel: vi.fn(async () => true),
      comment: vi.fn(async () => ({})),
      get: vi.fn(async () => ({
        items: [
          { item_id: 1, qty_ordered: 2, qty_shipped: 0 },
          { item_id: 2, parent_item_id: 1, qty_ordered: 2 },
        ],
      })),
      invoice: vi.fn(async () => 9),
      ship: vi.fn(async () => 5),
    },
    setCompanyCreditLimit: vi.fn(async () => ({})),
    setCompanyStatus: vi.fn(async () => ({})),
    setProductPrice: vi.fn(async () => ({})),
    setStock: vi.fn(async () => []),
  };
}
const ledger = { recordCompanyWrite: vi.fn(async () => []) };

describe("Given the outbox drain", () => {
  test("Then a price entry sets the product price", async () => {
    const commerce = fakeCommerce();
    const r = await applyEntry(
      {},
      { kind: "material.price", listPrice: 12.5, sku: "A1" },
      { commerce, ledger },
    );
    expect(commerce.setProductPrice).toHaveBeenCalledWith({}, "A1", 12.5);
    expect(r.applied).toBe(true);
  });
  test("Then a credit-limit entry writes Commerce and ledgers the value before", async () => {
    const commerce = fakeCommerce();
    await applyEntry(
      {},
      {
        commerceCompanyId: "7",
        creditLimit: 250,
        kind: "partner.creditLimit",
        partnerId: "C7",
      },
      { commerce, ledger },
    );
    expect(commerce.setCompanyCreditLimit).toHaveBeenCalledWith(
      {},
      42,
      "7",
      250,
    );
    expect(ledger.recordCompanyWrite).toHaveBeenCalledWith({
      after: 250,
      before: 1000,
      companyId: "7",
      extra: { creditId: 42 },
      field: "creditLimit",
    });
  });
  test("Then a block entry sets status 3 and ledgers the previous status", async () => {
    const commerce = fakeCommerce();
    await applyEntry(
      {},
      {
        blocked: true,
        commerceCompanyId: "7",
        kind: "partner.blocked",
        partnerId: "C7",
      },
      { commerce, ledger },
    );
    expect(commerce.setCompanyStatus).toHaveBeenCalledWith({}, "7", 3);
    expect(ledger.recordCompanyWrite).toHaveBeenCalledWith({
      after: 3,
      before: 1,
      companyId: "7",
      field: "status",
    });
  });
  test("Then a partner without a Commerce company is skipped, not failed", async () => {
    const r = await applyEntry(
      {},
      { kind: "partner.blocked", partnerId: "P000000" },
      { commerce: fakeCommerce(), ledger },
    );
    expect(r.applied).toBe(false);
  });
  test("Then order statuses map to comment, ship (top-level lines only), invoice and cancel", async () => {
    const commerce = fakeCommerce();
    const deps = { commerce, erpName: "Acme ERP", ledger };
    const base = {
      commerceOrderId: "55",
      kind: "order.status",
      number: "0000001000",
    };
    await applyEntry({}, { ...base, status: "confirmed" }, deps);
    expect(commerce.orders.comment).toHaveBeenCalledWith(
      {},
      "55",
      "Acme ERP: sales order 0000001000 confirmed",
    );
    await applyEntry({}, { ...base, status: "shipped" }, deps);
    expect(commerce.orders.ship).toHaveBeenCalledWith(
      {},
      "55",
      [{ order_item_id: 1, qty: 2 }],
      "Acme ERP: sales order 0000001000 shipped",
    );
    await applyEntry({}, { ...base, status: "invoiced" }, deps);
    expect(commerce.orders.invoice).toHaveBeenCalledWith({}, "55");
    await applyEntry({}, { ...base, status: "cancelled" }, deps);
    expect(commerce.orders.cancel).toHaveBeenCalledWith({}, "55");
  });
  test("Then drain applies in order, acks applied and skipped, keeps failed pending", async () => {
    const commerce = fakeCommerce();
    commerce.setStock.mockRejectedValueOnce(new Error("boom"));
    const erp = {
      ack: vi.fn(async () => ({ data: { acked: 2 }, ok: true, status: 200 })),
      outbox: vi.fn(async () => ({
        data: {
          items: [
            { _id: "a", kind: "material.stock", sku: "A1", stock: 1 },
            { _id: "b", kind: "material.price", listPrice: 2, sku: "A1" },
            { _id: "c", kind: "weird" },
          ],
        },
        ok: true,
        status: 200,
      })),
    };
    const result = await drain({}, { commerce, erp, ledger });
    expect(result.failed.map((f) => f.id)).toEqual(["a"]);
    expect(result.applied.map((a) => a.id)).toEqual(["b"]);
    expect(result.skipped.map((s) => s.id)).toEqual(["c"]);
    expect(erp.ack).toHaveBeenCalledWith({}, ["b", "c"]);
  });
  test("Then an unreachable outbox is an error", async () => {
    const erp = { outbox: async () => ({ data: {}, ok: false, status: 503 }) };
    await expect(
      drain({}, { commerce: fakeCommerce(), erp, ledger }),
    ).rejects.toThrow(STATUS_503);
  });
});
