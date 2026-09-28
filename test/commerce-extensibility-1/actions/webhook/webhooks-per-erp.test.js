/*
 * The cart checks with several ERPs (Phase B slice B3b, design v1 §3.2): each owning ERP is
 * asked for its own lines' prices, at its own address, for its own customer, and the answers
 * merge into one Commerce response. A slow or failed ERP leaves its lines at Commerce's price;
 * it never fails the cart. One ERP is covered by webhooks.test.js, unchanged.
 */
vi.mock("#lib/erp", () => ({ erp: { quote: vi.fn() } }));
vi.mock("#lib/settings", () => ({
  settingsFor: vi.fn(async () => ({
    pricing_contract_prices: true,
    pricing_discount_ceiling: true,
  })),
}));
vi.mock("#lib/commerce", () => ({
  productAttributes: vi.fn(async (_params, sku) => ({
    erp_owner: { BOTH: "brand-a", CAB1: "brand-a", SIGN1: "brand-b" }[sku],
  })),
  sourceCodesOf: vi.fn(async () => []),
}));

import { erp } from "#lib/erp";
import { resetErpsClient } from "#lib/erps";
import { pairCustomer, resetKeyMapClient } from "#lib/key-map";
import * as discounts from "#src/webhook/discounts/index";
import * as itemPrices from "#src/webhook/item-prices/index";

const A = "https://a.example";
const B = "https://b.example";
const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: A },
    id: "brand-a",
    name: "Brand A ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: B },
    id: "brand-b",
    name: "Brand B ERP",
  },
];

function memoryState(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

const line = (itemId, sku, basePrice, qty = 1) => ({
  base_discount_amount: 0,
  base_price: basePrice,
  item_id: itemId,
  qty,
  sku,
});

/** A cart with one brand-a line, one brand-b line and one line no ERP owns. */
const cart = {
  quote: { customer_group_id: 1, extension_attributes: { company_id: 20 } },
  shippingAssignment: {
    items: [
      line(1, "CAB1", 100),
      line(2, "SIGN1", 50, 2),
      line(3, "NOBODY", 10),
    ],
  },
};

/** Each ERP answers for the lines it was asked about, from its own table. */
function quoteBy(prices) {
  return (params, body) => {
    const table = prices[params.ERP_BASE_URL];
    if (table instanceof Error) {
      return Promise.reject(table);
    }
    return Promise.resolve({
      data: {
        lines: body.lines.map((l) => ({ sku: l.sku, ...table[l.sku] })),
        partnerId: body.partnerId,
      },
      ok: true,
      status: 200,
    });
  };
}

beforeEach(async () => {
  resetErpsClient(memoryState({ "erp-list": JSON.stringify(ERPS) }));
  resetKeyMapClient(memoryState());
  await pairCustomer("20", "A-20", "brand-a");
  await pairCustomer("20", "B-20", "brand-b");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given a cart whose lines belong to two ERPs", () => {
  test("Then item-prices asks each ERP for only its lines, at its address, as its customer, and merges the prices", async () => {
    erp.quote.mockImplementation(
      quoteBy({
        [A]: { CAB1: { contractPrice: 80 } },
        [B]: { SIGN1: { contractPrice: 40 } },
      }),
    );
    const res = await itemPrices.main(cart);

    const calls = erp.quote.mock.calls.map(([params, body]) => [
      params.ERP_BASE_URL,
      body.partnerId,
      body.lines.map((l) => l.sku),
    ]);
    expect(calls).toEqual(
      expect.arrayContaining([
        [A, "A-20", ["CAB1"]],
        [B, "B-20", ["SIGN1"]],
      ]),
    );
    expect(calls).toHaveLength(2);
    expect(res.body).toEqual([
      {
        op: "replace",
        path: "result/price_updates",
        value: [
          { base_price: 80, item_id: 1 },
          { base_price: 40, item_id: 2 },
        ],
      },
    ]);
  });

  test("Then an ERP that fails or refuses leaves its lines at Commerce's price, and the other ERP's prices still apply", async () => {
    erp.quote.mockImplementation(
      quoteBy({
        [A]: { CAB1: { contractPrice: 80 } },
        [B]: new Error("timed out"),
      }),
    );
    const res = await itemPrices.main(cart);
    expect(res.body[0].value).toEqual([{ base_price: 80, item_id: 1 }]);
  });

  test("Then the ERPs are asked at the same time, not one after the other", async () => {
    const started = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    erp.quote.mockImplementation(async (params, body) => {
      started.push(params.ERP_BASE_URL);
      if (started.length === 2) {
        release();
      }
      await gate;
      return { data: { lines: body.lines }, ok: true, status: 200 };
    });
    await itemPrices.main(cart);
    expect(started.sort()).toEqual([A, B]);
  });

  test("Then discounts claws back each ERP's excess over its own ceiling, summed into one cart discount", async () => {
    erp.quote.mockImplementation(
      quoteBy({
        [A]: { CAB1: { listPrice: 100, maxDiscountPercent: 10 } },
        [B]: { SIGN1: { listPrice: 50, maxDiscountPercent: 10 } },
      }),
    );
    const discounted = {
      ...cart,
      shippingAssignment: {
        items: [
          { ...line(1, "CAB1", 100), base_discount_amount: 20 },
          { ...line(2, "SIGN1", 50, 2), base_discount_amount: 20 },
        ],
      },
    };
    const res = await discounts.main(discounted);
    // Brand A: floor 90, paid 80 → 10. Brand B: floor 45, paid 40 each × 2 → 10.
    expect(res.body[0].value).toMatchObject({
      base_discount: -20,
      discount_item_id_array: [1, 2],
    });
  });
});
