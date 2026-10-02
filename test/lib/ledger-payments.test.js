/*
 * A payment the ERP posted gave a company credit back in Commerce (AB-26s). That is a write the
 * ERP made on Commerce, and Commerce can undo it, so it is ledgered and a reset takes it back
 * (principle 1: whatever can be done can be undone). A payment is a MOVE, not a value: the
 * entry holds the amount and the credit it went to, one entry per ERP payment, and the revert
 * hands the entry to the payment writer (lib/detach.js: decreaseBalance, type 4).
 */
import {
  readLedger,
  recordPaymentWrite,
  resetLedgerClient,
  revertLedger,
} from "#lib/ledger";

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

beforeEach(() => {
  resetLedgerClient(memoryState());
});

const writers = () => ({
  creditLimit: vi.fn(),
  customAttributes: vi.fn(),
  name: vi.fn(),
  payment: vi.fn(),
  price: vi.fn(),
  status: vi.fn(),
  stock: vi.fn(),
  tierPrice: vi.fn(),
});

const PAYMENT = {
  amount: 42.5,
  companyId: "21",
  creditId: 22,
  currency: "USD",
  erpId: "justrite",
  incrementId: "5000000002",
  paymentNumber: "7000000001",
};

describe("Given a payment reimbursed to a company's credit", () => {
  test("Then the ledger holds one entry naming the ERP, the credit, the amount and the order", async () => {
    await recordPaymentWrite(PAYMENT);
    await recordPaymentWrite(PAYMENT);

    expect(await readLedger()).toEqual([
      {
        after: 42.5,
        at: expect.any(String),
        before: null,
        companyId: "21",
        creditId: 22,
        currency: "USD",
        erpId: "justrite",
        field: "balance",
        id: "justrite/7000000001",
        incrementId: "5000000002",
        kind: "payment",
        paymentNumber: "7000000001",
      },
    ]);
  });

  test("Then a reset hands the entry to the payment writer and nothing else, and the ledger empties", async () => {
    await recordPaymentWrite(PAYMENT);
    const w = writers();

    const result = await revertLedger(w);

    expect(result).toEqual({ failed: [], reverted: 1 });
    expect(w.payment).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        after: 42.5,
        creditId: 22,
        currency: "USD",
        incrementId: "5000000002",
        kind: "payment",
        paymentNumber: "7000000001",
      }),
    );
    expect(w.status).not.toHaveBeenCalled();
    expect(await readLedger()).toEqual([]);
  });

  test("Then resetting one ERP takes back its own payments and leaves another ERP's", async () => {
    await recordPaymentWrite(PAYMENT);
    await recordPaymentWrite({
      ...PAYMENT,
      erpId: "accuform",
      paymentNumber: "7000000001",
    });
    const w = writers();

    await revertLedger(w, "justrite");

    expect(w.payment.mock.calls.map(([e]) => e.id)).toEqual([
      "justrite/7000000001",
    ]);
    expect((await readLedger()).map((e) => e.id)).toEqual([
      "accuform/7000000001",
    ]);
  });
});
