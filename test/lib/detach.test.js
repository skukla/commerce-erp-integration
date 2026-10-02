import { detach } from "#lib/detach";

describe("Given detach", () => {
  test("Then it reverts the ledger and clears the ERP number on every ERP-numbered order", async () => {
    const commerce = {
      clearExtOrderId: vi.fn(async () => ({})),
      // The ERP lists the customer's order number (its contract version 16); Commerce finds the id.
      findOrderByIncrementId: vi.fn(async (_p, number) => ({
        entityId: Number(number),
      })),
      setCompanyCreditLimit: vi.fn(),
      setCompanyStatus: vi.fn(),
      unholdIfHeld: vi.fn(async () => true),
    };
    const erp = {
      listOrders: vi.fn(async () => ({
        data: {
          items: [
            { number: "0000001000", purchaseOrderByCustomer: "0000055" },
            { number: "0000001001", purchaseOrderByCustomer: null },
          ],
        },
        ok: true,
        status: 200,
      })),
    };
    const ledger = {
      revertLedger: vi.fn(async () => ({ failed: [], reverted: 2 })),
    };
    const result = await detach({}, { commerce, erp, ledger });
    expect(commerce.clearExtOrderId).toHaveBeenCalledTimes(1);
    expect(commerce.clearExtOrderId).toHaveBeenCalledWith({}, "55");
    expect(commerce.unholdIfHeld).not.toHaveBeenCalled();
    expect(result).toEqual({
      holds: { failed: [], released: 0 },
      orders: { cleared: 1, failed: [] },
      reverted: { failed: [], reverted: 2 },
    });
  });
  // A credit hold is a state Commerce can undo, so an order the ERP still holds comes off
  // hold when the ERP goes; one Commerce already released is left alone and not counted.
  test("Then every order the ERP still holds is taken off hold, and a refusal is reported", async () => {
    const commerce = {
      clearExtOrderId: vi.fn(async () => ({})),
      // The ERP lists the customer's order number (its contract version 16); Commerce finds the id.
      findOrderByIncrementId: vi.fn(async (_p, number) => ({
        entityId: Number(number),
      })),
      unholdIfHeld: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error("locked")),
    };
    const erp = {
      listOrders: vi.fn(async () => ({
        data: {
          items: [
            { creditStatus: "held", purchaseOrderByCustomer: "000001" },
            { creditStatus: "held", purchaseOrderByCustomer: "000002" },
            { creditStatus: "held", purchaseOrderByCustomer: "000003" },
            { creditStatus: "approved", purchaseOrderByCustomer: "000004" },
          ],
        },
        ok: true,
        status: 200,
      })),
    };
    const ledger = {
      revertLedger: vi.fn(async () => ({ failed: [], reverted: 0 })),
    };
    const result = await detach({ p: 1 }, { commerce, erp, ledger });
    expect(commerce.unholdIfHeld).toHaveBeenCalledTimes(3);
    expect(commerce.unholdIfHeld).toHaveBeenCalledWith({ p: 1 }, "1");
    expect(result.holds).toEqual({
      failed: [{ error: "locked", orderId: "3" }],
      released: 1,
    });
  });
  test("Then a Commerce refusal on one order is reported and the rest continue", async () => {
    const commerce = {
      clearExtOrderId: vi
        .fn()
        .mockRejectedValueOnce(new Error("locked"))
        .mockResolvedValue({}),
      // The ERP lists the customer's order number (its contract version 16); Commerce finds the id.
      findOrderByIncrementId: vi.fn(async (_p, number) => ({
        entityId: Number(number),
      })),
      setCompanyCreditLimit: vi.fn(),
      setCompanyStatus: vi.fn(),
    };
    const erp = {
      listOrders: () =>
        Promise.resolve({
          data: {
            items: [
              { purchaseOrderByCustomer: "000001" },
              { purchaseOrderByCustomer: "000002" },
            ],
          },
          ok: true,
          status: 200,
        }),
    };
    const ledger = {
      revertLedger: () => Promise.resolve({ failed: [], reverted: 0 }),
    };
    const result = await detach({}, { commerce, erp, ledger });
    expect(result.orders).toEqual({
      cleared: 1,
      failed: [{ error: "locked", orderId: "1" }],
    });
  });
  test("Then an unreachable ERP order list is reported, after the ledger was still reverted", async () => {
    const ledger = {
      revertLedger: vi.fn(() => Promise.resolve({ failed: [], reverted: 1 })),
    };
    const result = await detach(
      {},
      {
        commerce: {},
        erp: {
          listOrders: () =>
            Promise.resolve({ data: {}, ok: false, status: 503 }),
        },
        ledger,
      },
    );
    expect(ledger.revertLedger).toHaveBeenCalled();
    expect(result.orders.failed).toEqual([
      { error: "ERP orders answered 503", orderId: "*" },
    ]);
  });
  // Commerce is the permanent system and the ERP is transient (owner, 2026-09-23): a
  // price or a stock level the ERP decided has to go back when the integration does,
  // the same way company credit and blocks already did.
  test("Then it hands the ledger a way to put prices and stock back too", async () => {
    const commerce = {
      clearExtOrderId: vi.fn(async () => ({})),
      // The ERP lists the customer's order number (its contract version 16); Commerce finds the id.
      findOrderByIncrementId: vi.fn(async (_p, number) => ({
        entityId: Number(number),
      })),
      setCompanyCreditLimit: vi.fn(),
      setCompanyStatus: vi.fn(),
      setProductPrice: vi.fn(),
      setStock: vi.fn(),
    };
    const erp = {
      listOrders: vi.fn(async () => ({ data: { items: [] }, ok: true })),
    };
    let handed;
    const ledger = {
      revertLedger: vi.fn((writers) => {
        handed = writers;
        return Promise.resolve({ failed: [], reverted: 0 });
      }),
    };

    await detach({ p: 1 }, { commerce, erp, ledger });

    await handed.price("A1", 120);
    await handed.stock("A1", "east", 10);
    expect(commerce.setProductPrice).toHaveBeenCalledWith({ p: 1 }, "A1", 120);
    expect(commerce.setStock).toHaveBeenCalledWith({ p: 1 }, "A1", 10, "east");
  });
});

// AB-26z: contract prices written into shared catalogs are ledgered tier prices; detach
// hands each one to the tier-price writer, which deletes it or restores the old price.
describe("Given ledgered tier prices", () => {
  test("Then detach reverts each through the tier-price writer", async () => {
    const entry = { customerGroup: "G", id: "A1", kind: "tierPrice" };
    const tierPrices = { revertTierPrice: vi.fn(async () => undefined) };
    const ledger = {
      revertLedger: vi.fn(async (writers) => {
        await writers.tierPrice(entry);
        return { failed: [], reverted: 1 };
      }),
    };
    const erp = {
      listOrders: vi.fn(async () => ({ data: { items: [] }, ok: true })),
    };
    await detach({ p: 1 }, { commerce: {}, erp, ledger, tierPrices });
    expect(tierPrices.revertTierPrice).toHaveBeenCalledWith({ p: 1 }, entry);
  });
});
