/*
 * Resetting one ERP (AB-16c, .rptc/plans/several-erps/per-erp-reset.md in Demo Builder):
 * `detach` with `erp` undoes only what that ERP wrote. A company's credit is shared between the
 * ERPs (one attribute set, one total), so it is not restored from `before`: the ERP's own
 * attributes come off, and the limit becomes what the other ERPs still hold, or `before` when
 * none holds any. Products, tier prices and orders are that ERP's alone.
 */
import { detach } from "#lib/detach";
import * as ledger from "#lib/ledger";

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

const erpEntry = (id) => ({
  adapter: "demo-erp",
  connection: { baseUrl: `https://${id}.example` },
  id,
  name: `${id} ERP`,
});
const ERPS = [erpEntry("erp"), erpEntry("contoso")];

const attr = (code, value) => ({ attribute_code: code, value });

/** Commerce's companies now: 7 holds both ERPs' credit, 8 only Contoso's. */
const companiesNow = () => ({
  7: [
    attr("unrelated", "x"),
    attr("erp_erp_credit_limit", "1000"),
    attr("erp_contoso_credit_limit", "400"),
    attr("erp_contoso_exposure", "150"),
  ],
  8: [attr("erp_contoso_credit_limit", "300")],
});

/** Each ERP's order list, by its address. */
const ORDERS = {
  "https://contoso.example": [
    { creditStatus: "held", purchaseOrderByCustomer: "0000021" },
  ],
  "https://erp.example": [{ purchaseOrderByCustomer: "0000011" }],
};

let companies;
let commerce;
let erp;
beforeEach(async () => {
  ledger.resetLedgerClient(memoryState());
  companies = companiesNow();
  commerce = {
    clearExtOrderId: vi.fn(async () => ({})),
    // The ERP lists the customer's order number (its contract version 16); Commerce finds the id.
    findOrderByIncrementId: vi.fn(async (_p, number) => ({
      entityId: Number(number),
    })),
    getCompany: vi.fn(async (_p, id) => ({
      custom_attributes: companies[id],
      id,
    })),
    setCompanyCreditLimit: vi.fn(async () => ({})),
    setCompanyCustomAttributes: vi.fn(async () => ({})),
    setProductPrice: vi.fn(async () => ({})),
    unholdIfHeld: vi.fn(async () => true),
  };
  erp = {
    listOrders: vi.fn(async (params) => ({
      data: { items: ORDERS[new URL(params.ERP_BASE_URL).origin] },
      ok: true,
      status: 200,
    })),
  };
  await seedLedger();
});

async function credit(companyId, erpId, creditId, before) {
  await ledger.recordCompanyWrite({
    after: [],
    before: [attr("unrelated", "x")],
    companyId,
    erpId,
    field: "customAttributes",
  });
  await ledger.recordCompanyWrite({
    after: 1,
    before,
    companyId,
    erpId,
    extra: { creditId },
    field: "creditLimit",
  });
}

async function seedLedger() {
  await credit(7, "erp", 42, 100);
  await credit(7, "contoso", 42, 100);
  await credit(8, "contoso", 43, 50);
  await ledger.recordProductWrite({
    after: 89,
    before: 120,
    erpId: "contoso",
    field: "price",
    sku: "A1",
  });
  await ledger.recordProductWrite({
    after: 8,
    before: 9,
    erpId: "erp",
    field: "price",
    sku: "B1",
  });
}

const deps = () => ({ commerce, erp, erps: ERPS, ledger, tierPrices: {} });

describe("Given two ERPs and detach for one of them", () => {
  test("Then only its attributes come off each company it wrote, the rest of the set kept", async () => {
    await detach({ erp: "contoso" }, deps());
    expect(commerce.setCompanyCustomAttributes.mock.calls).toEqual([
      [
        { erp: "contoso" },
        "7",
        [attr("unrelated", "x"), attr("erp_erp_credit_limit", "1000")],
      ],
      [{ erp: "contoso" }, "8", []],
    ]);
  });

  test("Then the credit limit is what the other ERPs hold, or what it was before when none does", async () => {
    await detach({ erp: "contoso" }, deps());
    expect(commerce.setCompanyCreditLimit.mock.calls).toEqual([
      [{ erp: "contoso" }, 42, "7", 1000],
      [{ erp: "contoso" }, 43, "8", 50],
    ]);
  });

  test("Then only its products are put back, and only its orders are cleared and released", async () => {
    await detach({ erp: "contoso" }, deps());
    expect(commerce.setProductPrice.mock.calls).toEqual([
      [{ erp: "contoso" }, "A1", 120],
    ]);
    expect(erp.listOrders).toHaveBeenCalledTimes(1);
    expect(commerce.clearExtOrderId.mock.calls.map(([, id]) => id)).toEqual([
      "21",
    ]);
    expect(commerce.unholdIfHeld.mock.calls.map(([, id]) => id)).toEqual([
      "21",
    ]);
  });

  test("Then the ledger keeps the other ERP's entries, and the answer names the ERP undone", async () => {
    const result = await detach({ erp: "contoso" }, deps());
    expect(result).toEqual({
      erp: "contoso",
      holds: { failed: [], released: 1 },
      orders: { cleared: 1, failed: [] },
      reverted: { failed: [], reverted: 3 },
    });
    expect(
      (await ledger.readLedger()).map((e) => [e.id, e.field, e.erpIds]),
    ).toEqual([
      ["7", "customAttributes", ["erp"]],
      ["7", "creditLimit", ["erp"]],
      ["B1", "price", undefined],
    ]);
  });

  test("Then undoing the other ERP afterwards returns the company to what it had before", async () => {
    await detach({ erp: "contoso" }, deps());
    companies[7] = [
      attr("unrelated", "x"),
      attr("erp_erp_credit_limit", "1000"),
    ];
    commerce.setCompanyCreditLimit.mockClear();

    await detach({ erp: "erp" }, deps());

    expect(commerce.setCompanyCreditLimit.mock.calls).toEqual([
      [{ erp: "erp" }, 42, "7", 100],
    ]);
    expect(await ledger.readLedger()).toEqual([]);
  });

  test("Then a company Commerce refuses is reported and keeps its entries", async () => {
    commerce.setCompanyCreditLimit.mockRejectedValueOnce(new Error("locked"));
    const result = await detach({ erp: "contoso" }, deps());
    expect(result.reverted).toEqual({
      failed: [{ error: "locked", field: "credit", id: "7" }],
      reverted: 2,
    });
    expect(
      (await ledger.readLedger())
        .filter((e) => e.id === "7")
        .map((e) => e.erpIds),
    ).toEqual([
      ["erp", "contoso"],
      ["erp", "contoso"],
    ]);
  });
});

describe("Given credit ledgered before entries named their ERP", () => {
  test("Then a company whose attributes carry the ERP's credit is still that ERP's, and the rest the first ERP's", async () => {
    ledger.resetLedgerClient(memoryState());
    companies[8] = [
      attr("erp_contoso_credit_limit", "300"),
      attr("set_by_hand", "y"),
    ];
    await ledger.recordCompanyWrite({
      after: [attr("erp_contoso_credit_limit", "300")],
      before: [],
      companyId: 8,
      field: "customAttributes",
    });
    await ledger.recordCompanyWrite({
      after: 300,
      before: 50,
      companyId: 8,
      extra: { creditId: 43 },
      field: "creditLimit",
    });
    await ledger.recordProductWrite({
      after: 8,
      before: 9,
      field: "price",
      sku: "B1",
    });

    await detach({ erp: "contoso" }, deps());

    expect(commerce.setCompanyCustomAttributes).toHaveBeenCalledWith(
      { erp: "contoso" },
      "8",
      [attr("set_by_hand", "y")],
    );
    expect(commerce.setCompanyCreditLimit).toHaveBeenCalledWith(
      { erp: "contoso" },
      43,
      "8",
      50,
    );
    expect(commerce.setProductPrice).not.toHaveBeenCalled();
    expect((await ledger.readLedger()).map((e) => e.id)).toEqual(["B1"]);
  });
});
