/*
 * A payment the ERP posted against an invoice of an order (AB-26s, contract v14
 * be-observer.sales_order_payment_create). An order paid ON ACCOUNT gives its company the paid
 * amount back on its credit (increaseBalance, type 4, Reimbursed), ledgered so a reset takes it
 * back; an order paid any other way changes no credit. Either way the order gets one staff-only
 * comment. Keyed by the ERP and its payment number under the order's lock, so a redelivered
 * event reimburses and comments nothing twice. With several ERPs the payment must come from an
 * ERP that holds a part of the order, and the words name that ERP.
 *
 * State (order parts, order credits, ledger) is the real code over memory; Commerce is a
 * stand-in whose every call is asserted by its arguments.
 */
import { readLedger, resetLedgerClient } from "#lib/ledger";
import {
  lockOrder,
  resetOrderPartsClient,
  writeOrderParts,
} from "#lib/order-parts";
import { readOrderCredits, resetOrderReturnsClient } from "#lib/order-returns";
import { paymentFromErp } from "#router/payments";

function memoryState() {
  const store = new Map();
  return {
    delete: vi.fn(async (k) => store.delete(k)),
    get: vi.fn(async (k) =>
      store.has(k) ? { value: store.get(k) } : undefined,
    ),
    put: vi.fn(async (k, v) => store.set(k, v)),
    store,
  };
}

const ONE_ERP = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "erp",
    name: "Justrite ERP",
  },
];
const TWO_ERPS = [
  { ...ONE_ERP[0], id: "justrite" },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "accuform",
    name: "Accuform ERP",
  },
];
const ORDER = "5000000002";
const ORDER_ID = 31;

/** A B2B order paid on account: the company it was charged to is on the order. */
const onAccount = (over = {}) => ({
  customer_id: 44,
  entity_id: ORDER_ID,
  extension_attributes: {
    company_order_attributes: { company_id: 21, company_name: "Northgate" },
  },
  increment_id: ORDER,
  items: [{ item_id: 40, qty_ordered: 1, sku: "CAB1" }],
  payment: { method: "companycredit" },
  ...over,
});

/** The ERP's event value (contract v14). */
const payment = (over = {}) => ({
  amount: 42.5,
  currency: "USD",
  erpNumber: "0000001001",
  id: ORDER_ID,
  incrementId: ORDER,
  invoiceNumber: "0000000101",
  orderId: ORDER_ID,
  partnerId: "C10000",
  paymentNumber: "7000000001",
  reference: "Wire 88",
  ...over,
});

function collaborators(over = {}) {
  return {
    addComment: vi.fn(async () => ({})),
    companyIdOf: vi.fn(async () => "21"),
    erps: ONE_ERP,
    getCompanyCredit: vi.fn(async () => ({
      company_id: 21,
      currency_code: "USD",
      id: 22,
    })),
    getOrder: vi.fn(async () => onAccount()),
    increaseCompanyBalance: vi.fn(async () => true),
    wait: async () => undefined,
    ...over,
  };
}

const staffComment = (comment) => ({
  statusHistory: { comment, is_customer_notified: 0, is_visible_on_front: 0 },
});

let state;
beforeEach(() => {
  state = memoryState();
  resetOrderPartsClient(state);
  resetOrderReturnsClient(state);
  resetLedgerClient(state);
});

describe("Given a payment for an order paid on account", () => {
  test("Then the company's credit gets the amount back, Reimbursed, naming the order and the payment, and the order is noted", async () => {
    const deps = collaborators();

    const res = await paymentFromErp({}, ORDER_ID, payment(), deps);

    expect(res).toMatchObject({ erpId: "erp", matched: true });
    expect(deps.getOrder).toHaveBeenCalledExactlyOnceWith({}, ORDER_ID);
    expect(deps.getCompanyCredit).toHaveBeenCalledExactlyOnceWith({}, "21");
    expect(deps.increaseCompanyBalance).toHaveBeenCalledExactlyOnceWith(
      {},
      22,
      {
        comment:
          "Paid in Justrite ERP (payment 7000000001, invoice 0000000101)",
        currency: "USD",
        orderIncrement: ORDER,
        purchaseOrder: "7000000001",
        value: 42.5,
      },
    );
    expect(deps.addComment).toHaveBeenCalledExactlyOnceWith(
      {},
      ORDER_ID,
      staffComment("Paid in Justrite ERP (payment 7000000001)"),
    );
    // The company came off the order, not off the buyer.
    expect(deps.companyIdOf).not.toHaveBeenCalled();
  });

  test("Then the reimbursement is recorded on the order and in the ledger a reset reverts", async () => {
    await paymentFromErp({}, ORDER_ID, payment(), collaborators());

    expect((await readOrderCredits(ORDER)).payments).toEqual({
      "erp/7000000001": {
        amount: 42.5,
        at: expect.any(String),
        companyId: "21",
        creditId: 22,
        currency: "USD",
        reimbursed: true,
      },
    });
    expect(await readLedger()).toMatchObject([
      {
        after: 42.5,
        creditId: 22,
        currency: "USD",
        erpId: "erp",
        id: "erp/7000000001",
        incrementId: ORDER,
        kind: "payment",
        paymentNumber: "7000000001",
      },
    ]);
  });

  test("Then I/O Events delivering it again reimburses and notes nothing twice", async () => {
    const deps = collaborators();
    await paymentFromErp({}, ORDER_ID, payment(), deps);

    const again = await paymentFromErp({}, ORDER_ID, payment(), deps);

    expect(again).toMatchObject({ already: true, matched: true });
    expect(deps.increaseCompanyBalance).toHaveBeenCalledTimes(1);
    expect(deps.addComment).toHaveBeenCalledTimes(1);
    expect(await readLedger()).toHaveLength(1);
  });

  test("Then a second payment of the same order is its own reimbursement", async () => {
    const deps = collaborators();
    await paymentFromErp({}, ORDER_ID, payment(), deps);

    await paymentFromErp(
      {},
      ORDER_ID,
      payment({ amount: 10, paymentNumber: "7000000002" }),
      deps,
    );

    expect(
      deps.increaseCompanyBalance.mock.calls.map(([, , m]) => m.value),
    ).toEqual([42.5, 10]);
    expect((await readLedger()).map((e) => e.id)).toEqual([
      "erp/7000000001",
      "erp/7000000002",
    ]);
  });

  test("Then an order that does not name its company is resolved through its buyer", async () => {
    const { extension_attributes: _named, ...order } = onAccount();
    const deps = collaborators({ getOrder: vi.fn(async () => order) });

    await paymentFromErp({}, ORDER_ID, payment(), deps);

    expect(deps.companyIdOf).toHaveBeenCalledExactlyOnceWith({}, 44);
    expect(deps.getCompanyCredit).toHaveBeenCalledExactlyOnceWith({}, "21");
  });

  test("Then a buyer in no company changes no credit, and the order is still noted", async () => {
    const { extension_attributes: _named, ...order } = onAccount();
    const deps = collaborators({
      companyIdOf: vi.fn(async () => null),
      getOrder: vi.fn(async () => order),
    });

    const res = await paymentFromErp({}, ORDER_ID, payment(), deps);

    expect(res).toMatchObject({ matched: true });
    expect(deps.getCompanyCredit).not.toHaveBeenCalled();
    expect(deps.increaseCompanyBalance).not.toHaveBeenCalled();
    expect(deps.addComment).toHaveBeenCalledExactlyOnceWith(
      {},
      ORDER_ID,
      staffComment("Paid in Justrite ERP (payment 7000000001)"),
    );
    expect(await readLedger()).toEqual([]);
  });

  test("Then a reimbursement Commerce refuses records nothing, so the event is delivered again", async () => {
    const deps = collaborators({
      increaseCompanyBalance: vi
        .fn()
        .mockRejectedValue(new Error("Commerce answered 400")),
    });

    await expect(paymentFromErp({}, ORDER_ID, payment(), deps)).rejects.toThrow(
      "Commerce answered 400",
    );

    expect((await readOrderCredits(ORDER)).payments).toBeUndefined();
    expect(await readLedger()).toEqual([]);
    expect(deps.addComment).not.toHaveBeenCalled();
  });
});

describe("Given a payment for an order paid another way", () => {
  test("Then no credit is read or changed, nothing is ledgered, and the order is noted once", async () => {
    const deps = collaborators({
      getOrder: vi.fn(async () =>
        onAccount({ payment: { method: "checkmo" } }),
      ),
    });

    const res = await paymentFromErp({}, ORDER_ID, payment(), deps);
    await paymentFromErp({}, ORDER_ID, payment(), deps);

    expect(res).toMatchObject({ matched: true });
    expect(deps.companyIdOf).not.toHaveBeenCalled();
    expect(deps.getCompanyCredit).not.toHaveBeenCalled();
    expect(deps.increaseCompanyBalance).not.toHaveBeenCalled();
    expect(deps.addComment).toHaveBeenCalledExactlyOnceWith(
      {},
      ORDER_ID,
      staffComment("Paid in Justrite ERP (payment 7000000001)"),
    );
    expect(await readLedger()).toEqual([]);
    expect(
      (await readOrderCredits(ORDER)).payments["erp/7000000001"],
    ).toMatchObject({ reimbursed: false });
  });
});

describe("Given two ERPs", () => {
  beforeEach(async () => {
    await writeOrderParts(ORDER, {
      conflicts: [],
      parts: {
        accuform: {
          erpNumber: "B-200",
          itemIds: [38],
          skus: ["SIGN"],
          status: "sent",
        },
        justrite: {
          erpNumber: "A-100",
          itemIds: [40],
          skus: ["CAB1"],
          status: "sent",
        },
      },
      unrouted: [],
    });
  });

  test("Then a payment from the ERP of one part names that ERP, and is keyed by it", async () => {
    const deps = collaborators({ erps: TWO_ERPS });

    await paymentFromErp(
      {},
      ORDER_ID,
      payment({ erpId: "accuform", erpNumber: "B-200" }),
      deps,
    );

    expect(deps.increaseCompanyBalance.mock.calls[0][2].comment).toBe(
      "Paid in Accuform ERP (payment 7000000001, invoice 0000000101)",
    );
    expect(deps.addComment).toHaveBeenCalledExactlyOnceWith(
      {},
      ORDER_ID,
      staffComment("Paid in Accuform ERP (payment 7000000001)"),
    );
    expect((await readLedger()).map((e) => [e.id, e.erpId])).toEqual([
      ["accuform/7000000001", "accuform"],
    ]);
  });

  test("Then a payment from an ERP holding no part of the order is refused, and nothing is written", async () => {
    const deps = collaborators({ erps: TWO_ERPS });

    const res = await paymentFromErp(
      {},
      ORDER_ID,
      payment({ erpId: "fabrikam", erpNumber: "Z-1" }),
      deps,
    );

    expect(res.matched).toBe(false);
    expect(deps.getOrder).not.toHaveBeenCalled();
    expect(deps.increaseCompanyBalance).not.toHaveBeenCalled();
    expect(deps.addComment).not.toHaveBeenCalled();
  });
});

describe("Given a payment event that cannot be applied", () => {
  test.each([
    [{ paymentNumber: undefined }, "the payment has no number"],
    [{ amount: 0 }, "the payment amount 0 is not more than 0"],
    [{ amount: "lots" }, "the payment amount lots is not more than 0"],
  ])("Then %o is refused: %s", async (over, reason) => {
    const deps = collaborators();

    const res = await paymentFromErp({}, ORDER_ID, payment(over), deps);

    expect(res).toEqual({
      matched: false,
      reason: `order ${ORDER}: ${reason}`,
    });
    expect(deps.getOrder).not.toHaveBeenCalled();
  });

  test("Then while another write to the order runs it answers busy, and writes nothing", async () => {
    await lockOrder(ORDER);
    const deps = collaborators({ attempts: 1 });

    const res = await paymentFromErp({}, ORDER_ID, payment(), deps);

    expect(res).toMatchObject({ busy: true });
    expect(deps.increaseCompanyBalance).not.toHaveBeenCalled();
    expect(deps.addComment).not.toHaveBeenCalled();
  });
});
