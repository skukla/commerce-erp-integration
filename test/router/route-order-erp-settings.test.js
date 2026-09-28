/*
 * Per-ERP settings reach an ERP's part (Phase B slice B3b, design v1 §2): each part is sent
 * with its ERP's own sales organization (for the order's website) and ownership, over the
 * integration's configured values. An ERP that sets nothing sends what the integration says.
 */
import { resetOrderPartsClient } from "#lib/order-parts";
import { ownsSku } from "#lib/structure";
import { routeOrder } from "#router/route-order";

const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "brand-a",
    name: "Brand A ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "brand-b",
    name: "Brand B ERP",
    settings: {
      structure_owns: "sources",
      structure_owns_sources: "east",
      structure_sales_org: "2000",
      websites: { bodea: { structure_sales_org: "2100" } },
    },
  },
];

const ORDER = {
  base_currency_code: "USD",
  base_grand_total: 150,
  increment_id: "000000077",
  items: [
    { base_price: 100, item_id: 1, qty_ordered: 1, sku: "CAB1" },
    { base_price: 50, item_id: 2, qty_ordered: 1, sku: "SIGN1" },
  ],
  store_id: 3,
};

function deps() {
  const store = new Map();
  resetOrderPartsClient({
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  });
  return {
    addNote: vi.fn(async () => ({})),
    erp: {
      createOrder: vi.fn(async () => ({
        data: { number: "N-1" },
        ok: true,
        status: 201,
      })),
    },
    findOrder: vi.fn(async () => ({
      entityId: 41,
      extOrderId: null,
      storeId: 3,
    })),
    logger: { warn: vi.fn() },
    // CAB1 names brand-a in erp_owner; SIGN1 is stocked in source east (brand-b's setting).
    ownsSku: (p, sku, settings) =>
      ownsSku(p, sku, settings, {
        productAttributes: async () =>
          sku === "CAB1" ? { erp_owner: "brand-a" } : {},
        sourceCodesOf: async () => (sku === "SIGN1" ? ["east"] : ["default"]),
      }),
    setExtOrderId: vi.fn(async () => ({})),
    settingsFor: vi.fn(async () => ({
      orders_hold_offline: true,
      orders_send: true,
      structure_sales_org: "1000",
    })),
    websiteCodeOf: vi.fn(async () => "bodea"),
  };
}

describe("Given two ERPs, one with settings of its own", () => {
  test("Then each part carries its ERP's sales organization for the order's website, and its ownership decides its lines", async () => {
    const d = deps();
    await routeOrder({}, ORDER, d, ERPS);
    const sent = d.erp.createOrder.mock.calls.map(([params, body]) => ({
      erp: params.ERP_BASE_URL,
      salesOrg: body.salesOrg,
      skus: body.lines.map((l) => l.sku),
    }));
    expect(sent).toEqual([
      { erp: "https://a.example", salesOrg: "1000", skus: ["CAB1"] },
      { erp: "https://b.example", salesOrg: "2100", skus: ["SIGN1"] },
    ]);
    expect(d.websiteCodeOf).toHaveBeenCalledWith({}, 3);
  });
});
