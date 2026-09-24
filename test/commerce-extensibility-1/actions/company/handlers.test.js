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
  getOrder: vi.fn(async () => ({ state: "processing" })),
  holdOrder: vi.fn(async () => true),
  invoiceOrder: vi.fn(async () => 9),
  unholdOrder: vi.fn(async () => true),
}));
vi.mock("#lib/erp", () => ({
  erp: {
    order: vi.fn(async () => ({
      data: { creditStatus: "held", number: "0000001000" },
      ok: true,
      status: 200,
    })),
  },
}));

import { setCompanyCreditLimit, setCompanyStatus } from "#lib/commerce";
import { erp } from "#lib/erp";
import { recordCompanyWrite } from "#lib/ledger";
import * as creditUpdated from "#src/company/external/credit-updated/index";
import * as statusUpdated from "#src/company/external/status-updated/index";
import {
  addComment,
  cancelOrder,
  getOrder,
  holdOrder,
  invoiceOrder,
  unholdOrder,
} from "#src/order/commerce-order-api-client";
import * as cancelled from "#src/order/external/cancelled/index";
import * as hold from "#src/order/external/hold/index";
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
  test("Then cancelled cancels the order, notes the ERP's reason, and a missing id is refused", async () => {
    const res = await cancelled.main({
      data: { erpNumber: "0000001000", orderId: 55, reason: "Duplicate order" },
    });
    expect(res.statusCode).toBe(200);
    expect(cancelOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect(addComment).toHaveBeenCalledWith(expect.anything(), 55, {
      statusHistory: {
        comment:
          "Cancelled in the ERP (ERP sales order 0000001000): Duplicate order",
        is_customer_notified: 0,
        is_visible_on_front: 1,
      },
    });
    expect((await cancelled.main({ data: {} })).error.statusCode).toBe(400);
  });
});

describe("Given the ERP's credit hold event", () => {
  const held = {
    erpNumber: "0000001000",
    held: true,
    incrementId: "000000042",
    orderId: 55,
    reason: "Credit limit 1,000.00 exceeded by 100.00",
  };
  test("Then a hold puts the Commerce order On Hold and says why in its history", async () => {
    const res = await hold.main({ data: held });
    expect(res.statusCode).toBe(200);
    expect(erp.order).toHaveBeenCalledWith(expect.anything(), "0000001000");
    expect(holdOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect(addComment).toHaveBeenCalledWith(expect.anything(), 55, {
      statusHistory: {
        comment:
          "On credit hold in the ERP (ERP sales order 0000001000): Credit limit 1,000.00 exceeded by 100.00",
        is_customer_notified: 0,
        is_visible_on_front: 1,
      },
    });
  });
  test("Then a redelivered hold finds the order already On Hold and does not hold it twice", async () => {
    getOrder.mockResolvedValueOnce({ state: "holded" });
    const res = await hold.main({ data: held });
    expect(res.statusCode).toBe(200);
    expect(holdOrder).not.toHaveBeenCalled();
    expect(addComment).toHaveBeenCalledTimes(1);
  });
  test("Then a release takes an On Hold order off hold, and leaves one that is not alone", async () => {
    erp.order.mockResolvedValueOnce({
      data: { creditStatus: "released" },
      ok: true,
      status: 200,
    });
    getOrder.mockResolvedValueOnce({ state: "holded" });
    const res = await hold.main({
      data: { ...held, held: false, reason: null },
    });
    expect(res.statusCode).toBe(200);
    expect(unholdOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect(addComment).toHaveBeenCalledWith(expect.anything(), 55, {
      statusHistory: {
        comment: "Credit hold released in the ERP (ERP sales order 0000001000)",
        is_customer_notified: 0,
        is_visible_on_front: 1,
      },
    });
    erp.order.mockResolvedValueOnce({
      data: { creditStatus: "released" },
      ok: true,
      status: 200,
    });
    await hold.main({ data: { ...held, held: false, reason: null } });
    expect(unholdOrder).toHaveBeenCalledTimes(1);
  });
  test("Then an order this ERP does not know, or whose status disagrees, is refused (rule M2)", async () => {
    erp.order.mockResolvedValueOnce({ data: {}, ok: false, status: 404 });
    expect((await hold.main({ data: held })).error.statusCode).toBe(400);
    erp.order.mockResolvedValueOnce({
      data: { creditStatus: "approved" },
      ok: true,
      status: 200,
    });
    expect((await hold.main({ data: held })).error.statusCode).toBe(400);
    expect(holdOrder).not.toHaveBeenCalled();
    expect((await hold.main({ data: { orderId: 55 } })).error.statusCode).toBe(
      400,
    );
  });
  test("Then a rejected hold arrives as a cancel, which takes the order off hold first", async () => {
    getOrder.mockResolvedValueOnce({ state: "holded" });
    const res = await cancelled.main({
      data: { erpNumber: "0000001000", orderId: 55, reason: "Credit rejected" },
    });
    expect(res.statusCode).toBe(200);
    expect(unholdOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect(cancelOrder).toHaveBeenCalledWith(expect.anything(), 55);
  });
});
