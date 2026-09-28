/* The router, Phase B slice B0: with one ERP, the whole order is one part (pass-through). */
vi.mock("#lib/order-sync", () => ({
  sendOrderToErp: vi.fn(async () => ({
    message: "sent",
    outcome: "sent",
    statusCode: 200,
  })),
}));

import { sendOrderToErp } from "#lib/order-sync";
import { routeOrder } from "#router/route-order";

const ORDER = {
  increment_id: "000000042",
  items: [
    { item_id: 1, sku: "A1" },
    { item_id: 2, sku: "B2" },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given an order placed with one ERP in the list", () => {
  test("Then the whole order goes to that ERP's adapter as one part, with the same collaborators", async () => {
    const params = { ERP_BASE_URL: "https://erp.example/api" };
    const deps = { marker: "deps" };
    const result = await routeOrder(params, ORDER, deps);
    expect(result.outcome).toBe("sent");
    expect(sendOrderToErp).toHaveBeenCalledExactlyOnceWith(params, ORDER, deps);
  });

  test("Then an order whose lines come keyed by id is still one part", async () => {
    const keyed = { ...ORDER, items: { 1: ORDER.items[0], 2: ORDER.items[1] } };
    await routeOrder({}, keyed, {});
    expect(sendOrderToErp.mock.calls[0][1]).toBe(keyed);
  });
});

describe("Given an ERP list the router cannot use", () => {
  test("Then an ERP of an unknown kind is an error and nothing is sent", () => {
    expect(() =>
      routeOrder({}, ORDER, {}, [{ adapter: "sap", id: "erp-2" }]),
    ).toThrow('No adapter "sap" for ERP erp-2.');
    expect(sendOrderToErp).not.toHaveBeenCalled();
  });
});
