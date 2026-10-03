/*
 * Resetting one ERP (AB-16c) needs every ledger write to name the ERP that made it. The ERP's
 * product event names its ERP; a stock event does not (its value is a list of lines), so each
 * line's write is the ERP that owns the SKU, the same ERP its quantities were read from.
 */
vi.mock("#lib/ledger", () => ({ recordProductWrite: vi.fn(async () => []) }));
vi.mock("#lib/erps", async (importOriginal) => ({
  ...(await importOriginal()),
  loadErps: vi.fn(),
}));
vi.mock("#lib/commerce-before", () => ({
  nameOf: vi.fn(async () => "Before"),
  priceOf: vi.fn(async () => 120),
  quantityOf: vi.fn(async () => 10),
}));
vi.mock("#lib/commerce", () => ({
  productAttributes: vi.fn(async () => ({})),
  sourceCodesOf: vi.fn(async () => []),
  websiteCodesOf: vi.fn(async () => []),
}));
vi.mock("#lib/structure", async (importOriginal) => ({
  ...(await importOriginal()),
  // The owner of each SKU by its `erp_owner` attribute: A1 is contoso's, B1 nobody's.
  ownsSku: vi.fn(
    async (_p, sku, settings) =>
      sku === "A1" && settings.structure_owns_attribute === "erp_owner=contoso",
  ),
}));
const PRODUCT = {
  listPrice: 10,
  name: "Now",
  type: "simple",
  warehouses: [{ code: "east", quantity: 4 }],
};
vi.mock("#lib/erp-current", async (importOriginal) => ({
  ...(await importOriginal()),
  currentProduct: vi.fn(async () => PRODUCT),
  // Asks the action which ERP holds each SKU, as the real one does, then answers for it.
  currentProducts: vi.fn(async (_params, lines, paramsOfSku) => {
    const skus = [...new Set(lines.map((line) => line.sku))];
    for (const sku of skus) {
      // biome-ignore lint/performance/noAwaitInLoops: in order, as a stand-in
      await paramsOfSku(sku);
    }
    return new Map(skus.map((sku) => [sku, PRODUCT]));
  }),
}));
vi.mock("#src/product/external/updated/validator", () => ({
  validateData: () => ({ success: true }),
}));
vi.mock("#src/product/external/updated/sender", () => ({
  sendData: async () => ({ success: true }),
}));
vi.mock("#src/stock/external/updated/validator", () => ({
  validateData: () => ({ success: true }),
}));
vi.mock("#src/stock/external/updated/sender", () => ({
  sendData: async () => ({ success: true }),
}));

import { loadErps } from "#lib/erps";
import { recordProductWrite } from "#lib/ledger";
import * as productUpdated from "#src/product/external/updated/index";
import * as stockUpdated from "#src/stock/external/updated/index";

const entry = (id) => ({
  adapter: "demo-erp",
  connection: { baseUrl: `https://${id}.example` },
  id,
  name: `${id} ERP`,
});

afterEach(() => vi.clearAllMocks());

const writtenErps = () =>
  recordProductWrite.mock.calls.map(([w]) => [w.sku, w.field, w.erpId]);

describe("Given two ERPs", () => {
  beforeEach(() =>
    loadErps.mockResolvedValue([entry("erp"), entry("contoso")]),
  );

  test("Then a product event's price and name are ledgered as the ERP the event names", async () => {
    const res = await productUpdated.main({
      data: { erpId: "contoso", price: 1, sku: "A1" },
    });
    expect(res.statusCode).toBe(200);
    expect(writtenErps()).toEqual([
      ["A1", "price", "contoso"],
      ["A1", "name", "contoso"],
    ]);
  });

  test("Then a product event naming no ERP is ledgered as the first ERP's", async () => {
    await productUpdated.main({ data: { price: 1, sku: "B1" } });
    expect(writtenErps()).toEqual([
      ["B1", "price", "erp"],
      ["B1", "name", "erp"],
    ]);
  });

  test("Then each stock line is ledgered as the ERP that owns its SKU", async () => {
    const res = await stockUpdated.main({
      data: [
        { quantity: 1, sku: "A1", source: "east" },
        { quantity: 1, sku: "B1", source: "east" },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(writtenErps()).toEqual([
      ["A1", "stock", "contoso"],
      ["B1", "stock", "erp"],
    ]);
  });
});

describe("Given one ERP", () => {
  beforeEach(() => loadErps.mockResolvedValue([entry("contoso")]));

  test("Then every write is that ERP's", async () => {
    await productUpdated.main({ data: { price: 1, sku: "B1" } });
    await stockUpdated.main({
      data: [{ quantity: 1, sku: "B1", source: "east" }],
    });
    expect(writtenErps().map(([, , erpId]) => erpId)).toEqual([
      "contoso",
      "contoso",
      "contoso",
    ]);
  });
});
