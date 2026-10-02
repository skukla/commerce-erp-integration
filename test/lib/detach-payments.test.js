/*
 * A demo reset takes back the credit a payment gave a company (AB-26s, principle 1): the ledger's
 * payment entry reaches decreaseBalance, operation type 4, for the same amount, on the same
 * credit, naming the same order and payment. Measured live on Justrite 2026-10-02: that call
 * puts the available credit back to the cent. The ledger is the real one in memory; Commerce
 * is a stand-in recording the call.
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

const PARAMS = { LOG_LEVEL: "info" };

function deps() {
  return {
    balance: { decreaseCompanyBalance: vi.fn(async () => true) },
    commerce: { clearExtOrderId: vi.fn(), unholdIfHeld: vi.fn() },
    erp: {
      listOrders: vi.fn(async () => ({
        data: { items: [] },
        ok: true,
        status: 200,
      })),
    },
    ledger,
    tierPrices: {},
  };
}

beforeEach(async () => {
  ledger.resetLedgerClient(memoryState());
  await ledger.recordPaymentWrite({
    amount: 42.5,
    companyId: "21",
    creditId: 22,
    currency: "USD",
    erpId: "erp",
    incrementId: "5000000002",
    paymentNumber: "7000000001",
  });
});

describe("Given a payment the ERP posted gave a company credit back", () => {
  test("Then detach takes it back with decreaseBalance, Reimbursed, for the same amount", async () => {
    const d = deps();

    const result = await detach(PARAMS, d);

    expect(d.balance.decreaseCompanyBalance).toHaveBeenCalledExactlyOnceWith(
      PARAMS,
      22,
      {
        comment: "Demo reset: payment 7000000001 taken back",
        currency: "USD",
        orderIncrement: "5000000002",
        purchaseOrder: "7000000001",
        value: 42.5,
      },
    );
    expect(result.reverted).toEqual({ failed: [], reverted: 1 });
    expect(await ledger.readLedger()).toEqual([]);
  });

  test("Then a refusal keeps the entry for the next reset and is reported", async () => {
    const d = deps();
    d.balance.decreaseCompanyBalance.mockRejectedValue(
      new Error("Commerce answered 400"),
    );

    const result = await detach(PARAMS, d);

    expect(result.reverted.failed).toEqual([
      {
        error: "Commerce answered 400",
        field: "balance",
        id: "erp/7000000001",
      },
    ]);
    expect((await ledger.readLedger()).map((e) => e.kind)).toEqual(["payment"]);
  });
});
