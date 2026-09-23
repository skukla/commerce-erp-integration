import { detach } from "#lib/detach";

describe("Given detach", () => {
  test("Then it reverts the ledger and clears the ERP number on every ERP-numbered order", async () => {
    const commerce = {
      clearExtOrderId: vi.fn(async () => ({})),
      setCompanyCreditLimit: vi.fn(),
      setCompanyStatus: vi.fn(),
    };
    const erp = {
      listOrders: vi.fn(async () => ({
        data: {
          items: [
            { commerceOrderId: "55", number: "0000001000" },
            { commerceOrderId: null, number: "0000001001" },
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
    expect(result).toEqual({
      orders: { cleared: 1, failed: [] },
      reverted: { failed: [], reverted: 2 },
    });
  });
  test("Then a Commerce refusal on one order is reported and the rest continue", async () => {
    const commerce = {
      clearExtOrderId: vi
        .fn()
        .mockRejectedValueOnce(new Error("locked"))
        .mockResolvedValue({}),
      setCompanyCreditLimit: vi.fn(),
      setCompanyStatus: vi.fn(),
    };
    const erp = {
      listOrders: () =>
        Promise.resolve({
          data: { items: [{ commerceOrderId: "1" }, { commerceOrderId: "2" }] },
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
      revertLedger: vi.fn(async (writers) => {
        handed = writers;
        return { failed: [], reverted: 0 };
      }),
    };

    await detach({ p: 1 }, { commerce, erp, ledger });

    await handed.price("A1", 120);
    await handed.stock("A1", "east", 10);
    expect(commerce.setProductPrice).toHaveBeenCalledWith({ p: 1 }, "A1", 120);
    expect(commerce.setStock).toHaveBeenCalledWith({ p: 1 }, "A1", 10, "east");
  });
});
