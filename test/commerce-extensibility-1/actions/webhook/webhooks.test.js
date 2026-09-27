import {
  ok,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";

vi.mock("#lib/erp", () => ({ erp: { quote: vi.fn() } }));
vi.mock("#lib/settings", () => ({
  settingsFor: vi.fn(async () => ({
    pricing_contract_prices: true,
    pricing_discount_ceiling: true,
  })),
}));

import { erp } from "#lib/erp";
import { pairCustomer, resetKeyMapClient } from "#lib/key-map";
import { settingsFor } from "#lib/settings";
import * as discounts from "#src/webhook/discounts/index";
import * as itemPrices from "#src/webhook/item-prices/index";

/** The SDK's own "leave Commerce's outcome untouched" answer. */
const SUCCESS = ok(successOperation());
const cart = {
  quote: { customer_group_id: 4 },
  shippingAssignment: {
    items: [
      {
        base_discount_amount: 0,
        base_price: 100,
        item_id: 1,
        qty: 2,
        sku: "A",
      },
    ],
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

/* The real key map over an in-memory store: Commerce company 20 = ERP customer C000200. */
beforeEach(async () => {
  const store = new Map();
  resetKeyMapClient({
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  });
  await pairCustomer("20", "C000200");
});

/* The cart's company as Commerce sends it (measured on Bodea, 2026-09-27). */
const companyCart = (companyId) => ({
  ...cart,
  quote: {
    customer_group_id: 1,
    customer_id: "46",
    extension_attributes: { company_id: companyId },
  },
});

describe("Given a cart whose company Commerce names", () => {
  test("Then both checks send the ERP customer the key map pairs with it, and the company as a fallback", async () => {
    erp.quote.mockResolvedValue({
      data: { lines: [], partnerId: "C000200" },
      ok: true,
      status: 200,
    });
    await itemPrices.main(companyCart(20));
    await discounts.main(companyCart(20));
    for (const call of erp.quote.mock.calls) {
      expect(call[1]).toMatchObject({
        commerceCompanyId: "20",
        partnerId: "C000200",
      });
    }
    expect(erp.quote).toHaveBeenCalledTimes(2);
  });
  test("Then a company missing from the key map sends the company alone, for the ERP to match", async () => {
    erp.quote.mockResolvedValue({ data: { lines: [] }, ok: true, status: 200 });
    await itemPrices.main(companyCart(21));
    expect(erp.quote.mock.calls[0][1]).toMatchObject({
      commerceCompanyId: "21",
    });
    expect(erp.quote.mock.calls[0][1]).not.toHaveProperty("partnerId");
  });
});

describe("Given the item-prices webhook", () => {
  test("Then known lines get the contract price, unknown ones are left alone", async () => {
    erp.quote.mockResolvedValue({
      data: { lines: [{ contractPrice: 80, sku: "A" }], partnerId: "C7" },
      ok: true,
      status: 200,
    });
    const res = await itemPrices.main(cart);
    expect(erp.quote).toHaveBeenCalledWith(
      cart,
      {
        customerGroupId: "4",
        customerId: null,
        email: null,
        lines: [{ qty: 2, sku: "A" }],
      },
      6000,
    );
    expect(res.body).toEqual([
      {
        op: "replace",
        path: "result/price_updates",
        value: [{ base_price: 80, item_id: 1 }],
      },
    ]);
  });
  test("Then an empty cart, an ERP failure or an unknown SKU answers success", async () => {
    expect(
      await itemPrices.main({ shippingAssignment: { items: [] } }),
    ).toEqual(SUCCESS);
    erp.quote.mockResolvedValue({ data: {}, ok: false, status: 503 });
    expect(await itemPrices.main(cart)).toEqual(SUCCESS);
    erp.quote.mockResolvedValue({
      data: { lines: [{ sku: "A", unknown: true }] },
      ok: true,
      status: 200,
    });
    expect(await itemPrices.main(cart)).toEqual(SUCCESS);
  });
  test("Then contract prices switched off for the cart's store view leave the cart to Commerce", async () => {
    settingsFor.mockResolvedValueOnce({ pricing_contract_prices: false });
    const res = await itemPrices.main({
      ...cart,
      quote: { customer_group_id: 4, store_id: 3 },
    });
    expect(res).toEqual(SUCCESS);
    expect(settingsFor).toHaveBeenCalledWith(3, expect.anything());
    expect(erp.quote).not.toHaveBeenCalled();
  });
});

describe("Given the discounts webhook", () => {
  test("Then a line discounted below the ceiling is clawed back as a negative discount", async () => {
    erp.quote.mockResolvedValue({
      data: { lines: [{ listPrice: 100, maxDiscountPercent: 30, sku: "A" }] },
      ok: true,
      status: 200,
    });
    // contract price 80, and Commerce's own rule took another 20 per unit off 2 units: paid 60, floor 70
    const deep = {
      quote: {},
      shippingAssignment: {
        items: [
          {
            base_discount_amount: -40,
            base_price: 80,
            item_id: 1,
            qty: 2,
            sku: "A",
          },
        ],
      },
    };
    const res = await discounts.main(deep);
    expect(res.body).toEqual([
      {
        op: "replace",
        path: "result",
        value: {
          base_discount: -20,
          code: "erp_discount_ceiling",
          discount_description_array: ["ERP maximum discount"],
          discount_item_id_array: [1],
          discount_type: "fixed",
        },
      },
    ]);
  });
  test("Then a cart within its ceiling is left alone", async () => {
    erp.quote.mockResolvedValue({
      data: { lines: [{ listPrice: 100, maxDiscountPercent: 30, sku: "A" }] },
      ok: true,
      status: 200,
    });
    expect(await discounts.main(cart)).toEqual(SUCCESS);
  });
  test("Then the ceiling switched off for the cart's store view leaves the cart to Commerce", async () => {
    settingsFor.mockResolvedValueOnce({ pricing_discount_ceiling: false });
    expect(await discounts.main({ ...cart, quote: { store_id: 3 } })).toEqual(
      SUCCESS,
    );
    expect(settingsFor).toHaveBeenCalledWith(3, expect.anything());
    expect(erp.quote).not.toHaveBeenCalled();
  });
  test("Then excessOverCeiling is zero without a list price", () => {
    expect(
      discounts.excessOverCeiling(
        { basePrice: 1, nativeDiscount: 0, qty: 1 },
        { listPrice: 0, maxDiscountPercent: 10 },
      ),
    ).toBe(0);
  });
});
