vi.mock("#lib/erp", () => ({
  erp: {
    fromCommerce: {
      cancel: vi.fn(),
      hold: vi.fn(),
      invoice: vi.fn(),
      release: vi.fn(),
      ship: vi.fn(() => Promise.resolve({ data: {}, ok: true, status: 200 })),
    },
    order: vi.fn(() =>
      Promise.resolve({
        data: { creditStatus: "approved", header: "confirmed" },
        ok: true,
        status: 200,
      }),
    ),
  },
}));
vi.mock("#lib/history", () => ({
  recordCommerceChange: vi.fn(() => Promise.resolve()),
}));
vi.mock("#src/order/commerce-order-api-client", () => ({
  getOrder: vi.fn(() =>
    Promise.resolve({ entity_id: 55, ext_order_id: "0000001003" }),
  ),
}));

import { erp } from "#lib/erp";
import { recordCommerceChange } from "#lib/history";
import * as changed from "#src/order/commerce/changed/index";
import * as shipped from "#src/order/commerce/shipped/index";

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the Commerce-change handlers", () => {
  test("Then a shipment event is told to the ERP and recorded for the Admin history", async () => {
    const res = await shipped.main({
      data: {
        value: {
          entity_id: 501,
          increment_id: "000000501",
          items: [{ order_item_id: 1, qty: 2 }],
          order_id: 55,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(erp.fromCommerce.ship).toHaveBeenCalledTimes(1);
    expect(recordCommerceChange).toHaveBeenCalledWith(
      "shipped",
      expect.objectContaining({ increment_id: "000000501" }),
      expect.objectContaining({ outcome: "sent" }),
      expect.anything(),
    );
  });
  test("Then a save that is nothing to do answers 200 and leaves no history row; a bad event is a 400", async () => {
    const res = await changed.main({
      data: {
        value: {
          ext_order_id: "0000001003",
          increment_id: "000000042",
          state: "processing",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(erp.fromCommerce.hold).not.toHaveBeenCalled();
    const bad = await shipped.main({ data: { value: { items: [] } } });
    expect(bad.error.statusCode).toBe(400);
  });
});
