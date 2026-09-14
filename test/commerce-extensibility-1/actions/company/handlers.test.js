vi.mock("#lib/commerce", () => ({
  COMPANY_STATUS: { APPROVED: 1, BLOCKED: 3 },
  getCompany: vi.fn(async () => ({ id: 7, status: 1 })),
  getCompanyCredit: vi.fn(async () => ({ credit_limit: 1000, id: 42 })),
  setCompanyCreditLimit: vi.fn(async () => ({})),
  setCompanyStatus: vi.fn(async () => ({})),
}));
vi.mock("#lib/ledger", () => ({ recordCompanyWrite: vi.fn(async () => []) }));
vi.mock("#src/order/commerce-order-api-client", () => ({
  addComment: vi.fn(async () => ({})),
  cancelOrder: vi.fn(async () => true),
  invoiceOrder: vi.fn(async () => 9),
}));

import { setCompanyCreditLimit, setCompanyStatus } from "#lib/commerce";
import { recordCompanyWrite } from "#lib/ledger";
import * as creditUpdated from "#src/company/external/credit-updated/index";
import * as statusUpdated from "#src/company/external/status-updated/index";
import {
  addComment,
  cancelOrder,
  invoiceOrder,
} from "#src/order/commerce-order-api-client";
import * as cancelled from "#src/order/external/cancelled/index";
import * as invoiceCreated from "#src/order/external/invoice-created/index";

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the ERP company events", () => {
  test("Then a credit-limit event writes Commerce and ledgers the value before", async () => {
    const res = await creditUpdated.main({
      data: { companyId: "7", creditLimit: 250 },
    });
    expect(res.statusCode).toBe(200);
    expect(setCompanyCreditLimit).toHaveBeenCalledWith(
      expect.anything(),
      42,
      "7",
      250,
    );
    expect(recordCompanyWrite).toHaveBeenCalledWith({
      after: 250,
      before: 1000,
      companyId: "7",
      extra: { creditId: 42 },
      field: "creditLimit",
    });
  });
  test("Then a block event sets status 3 and ledgers the previous status", async () => {
    await statusUpdated.main({ data: { blocked: true, companyId: "7" } });
    expect(setCompanyStatus).toHaveBeenCalledWith(expect.anything(), "7", 3);
    expect(recordCompanyWrite).toHaveBeenCalledWith({
      after: 3,
      before: 1,
      companyId: "7",
      field: "status",
    });
  });
  test("Then a partner without a Commerce company is skipped, and a bad payload is refused", async () => {
    expect(
      (await creditUpdated.main({ data: { creditLimit: 1 } })).statusCode,
    ).toBe(200);
    expect(
      (await statusUpdated.main({ data: { blocked: "yes", companyId: "7" } }))
        .error.statusCode,
    ).toBe(400);
    expect(setCompanyStatus).not.toHaveBeenCalled();
  });
});

describe("Given the ERP order events the kit has no handler for", () => {
  test("Then invoice-created invoices the order and leaves a note", async () => {
    const res = await invoiceCreated.main({
      data: { erpNumber: "0000001000", orderId: 55 },
    });
    expect(res.statusCode).toBe(200);
    expect(invoiceOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect(addComment).toHaveBeenCalledWith(expect.anything(), 55, {
      statusHistory: {
        comment: "Invoiced in the ERP (ERP sales order 0000001000)",
        is_customer_notified: 0,
        is_visible_on_front: 1,
      },
    });
  });
  test("Then cancelled cancels the order, and a missing id is refused", async () => {
    expect((await cancelled.main({ data: { orderId: 55 } })).statusCode).toBe(
      200,
    );
    expect(cancelOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect((await cancelled.main({ data: {} })).error.statusCode).toBe(400);
  });
});
