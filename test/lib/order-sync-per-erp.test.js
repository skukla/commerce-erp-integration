/*
 * An ERP's part of a split order names the buyer by THAT ERP's customer number (slice B3a):
 * a company buying from two brands is a different customer in each brand's ERP.
 */
import { sendOrderToErp } from "#lib/order-sync";

const ORDER = {
  base_currency_code: "USD",
  base_grand_total: 40,
  customer_id: 44,
  increment_id: "3000000004",
  items: [{ base_price: 20, item_id: 1, qty_ordered: 2, sku: "A" }],
  store_id: 3,
};

function deps() {
  return {
    addNote: vi.fn(async () => ({})),
    companyIdOf: vi.fn(async () => "21"),
    erp: {
      createOrder: vi.fn(async () => ({
        data: { number: "0000001002" },
        ok: true,
        status: 201,
      })),
    },
    erpCustomerOf: vi.fn(async (_companyId, erpId) =>
      erpId === "brand-b" ? "K-77" : "C000103",
    ),
    findOrder: vi.fn(async () => ({
      entityId: 41,
      extOrderId: null,
      storeId: 3,
    })),
    logger: { warn: vi.fn() },
    setExtOrderId: vi.fn(async () => ({})),
    settingsFor: vi.fn(async () => ({
      orders_hold_offline: true,
      orders_send: true,
    })),
  };
}

describe("Given one ERP's part of a split order", () => {
  test("Then the buyer is that ERP's own customer", async () => {
    const d = deps();
    await sendOrderToErp({}, ORDER, d, { erpId: "brand-b", shared: true });
    expect(d.erpCustomerOf).toHaveBeenCalledWith("21", "brand-b");
    expect(d.erp.createOrder.mock.calls[0][1]).toMatchObject({
      partnerId: "K-77",
    });
  });

  test("Then a whole order to the one ERP asks exactly as before, with no ERP id", async () => {
    const d = deps();
    await sendOrderToErp({}, ORDER, d);
    expect(d.erpCustomerOf.mock.calls[0]).toEqual(["21"]);
    expect(d.erp.createOrder.mock.calls[0][1]).toMatchObject({
      partnerId: "C000103",
    });
  });
});
