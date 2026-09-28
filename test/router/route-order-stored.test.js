/*
 * The router reads the ERP list Demo Builder stored (slice B3a) when its collaborators can
 * load it; a caller that hands it a list, or collaborators without a loader, keep today's path.
 */
vi.mock("#lib/order-sync", () => ({
  sendOrderToErp: vi.fn(async () => ({ outcome: "sent", statusCode: 200 })),
}));

import { sendOrderToErp } from "#lib/order-sync";
import { routeOrder } from "#router/route-order";

const ORDER = { increment_id: "000000042", items: [{ item_id: 1, sku: "A" }] };
const ONE = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "erp",
    name: "Northwind ERP",
  },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given collaborators that load the stored ERP list", () => {
  test("Then the router routes over the list they load", async () => {
    const loadErps = vi.fn(async () => ONE);
    const deps = { loadErps };
    const result = await routeOrder({ p: 1 }, ORDER, deps);
    expect(loadErps).toHaveBeenCalledWith({ p: 1 });
    expect(result.outcome).toBe("sent");
    expect(sendOrderToErp).toHaveBeenCalledWith({ p: 1 }, ORDER, deps);
  });

  test("Then a list that cannot be read fails the delivery, so the event is retried", async () => {
    const deps = {
      loadErps: vi.fn(async () => Promise.reject(new Error("state down"))),
    };
    await expect(routeOrder({}, ORDER, deps)).rejects.toThrow("state down");
    expect(sendOrderToErp).not.toHaveBeenCalled();
  });
});
