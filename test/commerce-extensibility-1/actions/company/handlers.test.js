vi.mock("#lib/commerce", () => ({
  COMPANY_STATUS: { APPROVED: 1, BLOCKED: 3 },
  getCompany: vi.fn(async () => ({ id: 7, status: 1 })),
  getCompanyCredit: vi.fn(async () => ({ credit_limit: 1000, id: 42 })),
  listWebsites: vi.fn(async () => []),
  productAttributes: vi.fn(async () => ({})),
  setCompanyCreditLimit: vi.fn(async () => ({})),
  setCompanyStatus: vi.fn(async () => ({})),
  sourceCodesOf: vi.fn(async () => []),
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
import { isBlocked, resetErpBlocksClient } from "#lib/erp-blocks";
import { pairCustomer, resetKeyMapClient } from "#lib/key-map";
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

/* The real key map over an in-memory store, holding one pair: Commerce 21 = ERP C000103. */
beforeEach(async () => {
  const store = new Map();
  resetKeyMapClient({
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  });
  await pairCustomer("21", "C000103");
});

describe("Given the ERP company events", () => {
  // The ERP names its customer by its own number only (contract version 3); the key map
  // (Commerce 21 = ERP C000103, set up above) names the Commerce company.
  test("Then a credit-limit event writes the paired Commerce company and ledgers the value before", async () => {
    const res = await creditUpdated.main({
      data: { creditLimit: 250, partnerId: "C000103" },
    });
    expect(res.statusCode).toBe(200);
    expect(setCompanyCreditLimit).toHaveBeenCalledWith(
      expect.anything(),
      42,
      "21",
      250,
    );
    expect(recordCompanyWrite).toHaveBeenCalledWith({
      after: 250,
      before: 1000,
      companyId: "21",
      erpId: "erp",
      extra: { creditId: 42 },
      field: "creditLimit",
    });
  });
  // Each ERP for itself, one ERP too (owner, 2026-09-28): the block is recorded against that
  // ERP and holds its orders; the Commerce company's own flag is never written.
  test("Then a block event with one ERP records the ERP's block on the paired company and never switches the company off", async () => {
    const store = new Map();
    resetErpBlocksClient({
      get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
      put: async (k, v) => store.set(k, v),
    });
    const res = await statusUpdated.main({
      data: { blocked: true, partnerId: "C000103" },
    });
    expect(res.statusCode).toBe(200);
    expect(await isBlocked("21", "erp")).toBe(true);
    expect(setCompanyStatus).not.toHaveBeenCalled();
    expect(recordCompanyWrite).not.toHaveBeenCalled();
  });
  test("Then a customer the key map does not pair is no Commerce company: skipped, even if the event names a Commerce id", async () => {
    const res = await creditUpdated.main({
      data: { companyId: "7", creditLimit: 250, partnerId: "C9" },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (await statusUpdated.main({ data: { blocked: true } })).statusCode,
    ).toBe(200);
    expect(setCompanyCreditLimit).not.toHaveBeenCalled();
    expect(setCompanyStatus).not.toHaveBeenCalled();
  });
  test("Then a bad payload is refused", async () => {
    expect(
      (
        await statusUpdated.main({
          data: { blocked: "yes", partnerId: "C000103" },
        })
      ).error.statusCode,
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
        is_visible_on_front: 0,
      },
    });
  });
  test("Then cancelled cancels the order, notes the ERP's reason, and a missing id is refused", async () => {
    getOrder
      .mockResolvedValueOnce({ state: "processing" })
      .mockResolvedValueOnce({ state: "canceled" });
    const res = await cancelled.main({
      data: { erpNumber: "0000001000", orderId: 55, reason: "Duplicate order" },
    });
    expect(res.statusCode).toBe(200);
    expect(cancelOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect(addComment).toHaveBeenCalledWith(expect.anything(), 55, {
      statusHistory: {
        comment:
          "Canceled in the ERP (ERP sales order 0000001000): Duplicate order",
        is_customer_notified: 0,
        is_visible_on_front: 0,
      },
    });
    expect((await cancelled.main({ data: {} })).error.statusCode).toBe(400);
  });
  test("Then an order Commerce will not cancel (already invoiced or shipped) is put On Hold, and its history says why instead of claiming a cancel", async () => {
    // Commerce keeps an order it cannot cancel; reading it back is the only proof either way.
    getOrder
      .mockResolvedValueOnce({ state: "processing" })
      .mockResolvedValueOnce({ state: "processing" });
    const res = await cancelled.main({
      data: { erpNumber: "0000001000", orderId: 55, reason: "Duplicate order" },
    });
    expect(res.statusCode).toBe(200);
    expect(cancelOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect(holdOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect(addComment).toHaveBeenCalledTimes(1);
    const { comment } = addComment.mock.calls[0][2].statusHistory;
    expect(comment).toBe(
      "Canceled in the ERP (ERP sales order 0000001000): Duplicate order. Commerce did not cancel this order because part of it is already invoiced or shipped. It is On Hold: close the rest with a credit memo.",
    );
  });
  test("Then a refused cancel that fails to hold still records why, and answers success so the event is not retried", async () => {
    getOrder
      .mockResolvedValueOnce({ state: "processing" })
      .mockResolvedValueOnce({ state: "complete" });
    holdOrder.mockRejectedValueOnce(
      new Error("The hold action is not available."),
    );
    const res = await cancelled.main({ data: { orderId: 55 } });
    expect(res.statusCode).toBe(200);
    expect(addComment.mock.calls[0][2].statusHistory.comment).toBe(
      "Canceled in the ERP. Commerce did not cancel this order because part of it is already invoiced or shipped. It could not be put On Hold: close the rest with a credit memo.",
    );
  });
});

describe("Given the ERP's credit hold event", () => {
  const held = {
    erpNumber: "0000001000",
    held: true,
    incrementId: "000000042",
    orderId: 55,
    reason: "Credit limit USD 1,000.00 exceeded by USD 100.00",
  };
  test("Then a hold puts the Commerce order On Hold and says why in its history", async () => {
    const res = await hold.main({ data: held });
    expect(res.statusCode).toBe(200);
    expect(erp.order).toHaveBeenCalledWith(expect.anything(), "0000001000");
    expect(holdOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect(addComment).toHaveBeenCalledWith(expect.anything(), 55, {
      statusHistory: {
        comment:
          "On credit hold in the ERP (ERP sales order 0000001000): Credit limit USD 1,000.00 exceeded by USD 100.00",
        is_customer_notified: 0,
        is_visible_on_front: 0,
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
        is_visible_on_front: 0,
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
    getOrder
      .mockResolvedValueOnce({ state: "holded" })
      .mockResolvedValueOnce({ state: "canceled" });
    const res = await cancelled.main({
      data: { erpNumber: "0000001000", orderId: 55, reason: "Credit rejected" },
    });
    expect(res.statusCode).toBe(200);
    expect(unholdOrder).toHaveBeenCalledWith(expect.anything(), 55);
    expect(cancelOrder).toHaveBeenCalledWith(expect.anything(), 55);
  });
});
