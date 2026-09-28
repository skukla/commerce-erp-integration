/*
 * The ERP's company events with several ERPs (design v1 §3.1): a block goes to the per-brand
 * path (never the Commerce company flag); a credit limit goes to the per-ERP attributes and
 * the total. One ERP keeps today's path (handlers.test.js).
 */
vi.mock("#lib/commerce", () => ({
  COMPANY_STATUS: { APPROVED: 1, BLOCKED: 3 },
  getCompany: vi.fn(async () => ({ id: 7, status: 1 })),
  getCompanyCredit: vi.fn(async () => ({ credit_limit: 1000, id: 42 })),
  getOrderByIncrementId: vi.fn(),
  setCompanyCreditLimit: vi.fn(async () => ({})),
  setCompanyCustomAttributes: vi.fn(async () => ({})),
  setCompanyStatus: vi.fn(async () => ({})),
}));
vi.mock("#lib/ledger", () => ({ recordCompanyWrite: vi.fn(async () => []) }));
vi.mock("#router/erp-blocks", () => ({
  applyErpBlock: vi.fn(async () => ({ orders: 1 })),
}));
vi.mock("#lib/erp-credit", () => ({
  applyErpCredit: vi.fn(async () => ({ total: 1500 })),
}));

import { setCompanyCreditLimit, setCompanyStatus } from "#lib/commerce";
import { applyErpCredit } from "#lib/erp-credit";
import { replaceErps, resetErpsClient } from "#lib/erps";
import { pairCustomer, resetKeyMapClient } from "#lib/key-map";
import { applyErpBlock } from "#router/erp-blocks";
import * as creditUpdated from "#src/company/external/credit-updated/index";
import * as statusUpdated from "#src/company/external/status-updated/index";

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

beforeEach(async () => {
  const state = memoryState();
  resetErpsClient(state);
  resetKeyMapClient(state);
  await replaceErps([
    {
      adapter: "demo-erp",
      connection: { baseUrl: "https://a.example" },
      id: "cabinets",
      name: "Cabinet ERP",
    },
    {
      adapter: "demo-erp",
      connection: { baseUrl: "https://b.example" },
      id: "signs",
      name: "Sign ERP",
    },
  ]);
  await pairCustomer("7", "C7", "signs");
});

afterEach(() => {
  vi.clearAllMocks();
  resetErpsClient(undefined);
});

describe("Given several ERPs", () => {
  test("Then a block from one ERP holds only its parts and never sets the company flag", async () => {
    const res = await statusUpdated.main({
      data: { blocked: true, erpId: "signs", partnerId: "C7" },
    });
    expect(res.statusCode).toBe(200);
    expect(applyErpBlock).toHaveBeenCalledWith(
      expect.anything(),
      { blocked: true, companyId: "7", erpId: "signs" },
      expect.objectContaining({ erps: expect.any(Array) }),
    );
    expect(setCompanyStatus).not.toHaveBeenCalled();
  });

  test("Then a credit limit from one ERP goes to its own attributes and the total", async () => {
    const res = await creditUpdated.main({
      data: {
        creditLimit: 500,
        erpId: "signs",
        exposure: 100,
        partnerId: "C7",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(applyErpCredit).toHaveBeenCalledWith(
      expect.anything(),
      {
        available: undefined,
        companyId: "7",
        creditLimit: 500,
        erpId: "signs",
        exposure: 100,
      },
      expect.objectContaining({ erps: expect.any(Array) }),
    );
    expect(setCompanyCreditLimit).not.toHaveBeenCalled();
  });

  test("Then an event that names no ERP is refused, since it cannot be attributed", async () => {
    await pairCustomer("7", "C7");
    const res = await statusUpdated.main({
      data: { blocked: true, partnerId: "C7" },
    });
    expect(res.statusCode ?? res.error?.statusCode).toBe(400);
    expect(applyErpBlock).not.toHaveBeenCalled();
  });
});

describe("Given a first ERP deployed before events named their ERP, and a second one added", () => {
  beforeEach(async () => {
    await replaceErps([
      {
        adapter: "demo-erp",
        connection: { baseUrl: "https://a.example" },
        id: "erp",
        name: "Northwind ERP",
      },
      {
        adapter: "demo-erp",
        connection: { baseUrl: "https://b.example" },
        id: "demo-erp-2",
        name: "Sign ERP",
      },
    ]);
    await pairCustomer("7", "C7");
  });

  test("Then a block that names no ERP is the first ERP's", async () => {
    const res = await statusUpdated.main({
      data: { blocked: true, partnerId: "C7" },
    });
    expect(res.statusCode ?? res.error?.statusCode).toBe(200);
    expect(applyErpBlock).toHaveBeenCalledWith(
      expect.anything(),
      { blocked: true, companyId: "7", erpId: "erp" },
      expect.anything(),
    );
  });

  test("Then a credit limit that names no ERP is the first ERP's", async () => {
    const res = await creditUpdated.main({
      data: { creditLimit: 500, partnerId: "C7" },
    });
    expect(res.statusCode ?? res.error?.statusCode).toBe(200);
    expect(applyErpCredit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: "7", erpId: "erp" }),
      expect.anything(),
    );
  });
});
