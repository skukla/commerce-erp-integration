/*
 * lib/erp-current: an ERP product event is a signal that a SKU changed; the value written
 * to Commerce is what the ERP holds NOW. Pinned because the stale-redelivery bug it fixes
 * (2026-09-25: a rename's undo lost to the rename's late retry) passes every test that
 * only checks the event's own values reach Commerce.
 */
vi.mock("#lib/erp", () => ({ erp: { product: vi.fn() } }));

import { erp } from "#lib/erp";
import {
  currentPriceEvent,
  currentProduct,
  currentProducts,
  currentStockLines,
} from "#lib/erp-current";

beforeEach(() => vi.clearAllMocks());

describe("currentProduct", () => {
  test("answers the ERP's product document", async () => {
    erp.product.mockResolvedValue({
      data: { name: "Now" },
      ok: true,
      status: 200,
    });
    expect(await currentProduct({}, "S1")).toEqual({ name: "Now" });
    expect(erp.product).toHaveBeenCalledWith({}, "S1");
  });

  test("answers null when the ERP has no such SKU", async () => {
    erp.product.mockResolvedValue({ data: {}, ok: false, status: 404 });
    expect(await currentProduct({}, "S1")).toBeNull();
  });

  test("throws on any other failure, so the event is delivered again", async () => {
    erp.product.mockResolvedValue({ data: {}, ok: false, status: 503 });
    await expect(currentProduct({}, "S1")).rejects.toThrow("503");
  });
});

describe("currentPriceEvent", () => {
  test("carries the ERP's name and list price, never the event's", () => {
    expect(
      currentPriceEvent("S1", {
        listPrice: 49,
        name: "Access Point",
        type: "simple",
      }),
    ).toEqual({ name: "Access Point", price: 49, sku: "S1" });
  });

  test("a configurable parent carries no price", () => {
    expect(
      currentPriceEvent("P1", {
        listPrice: 0,
        name: "Parent",
        type: "configurable",
      }),
    ).toEqual({ name: "Parent", sku: "P1" });
  });
});

describe("currentStockLines", () => {
  const products = new Map([
    [
      "S1",
      {
        warehouses: [
          { code: "default", quantity: 0 },
          { code: "east", quantity: 7 },
        ],
      },
    ],
    ["GONE", null],
  ]);

  test("takes each line's quantity from the ERP's warehouse now", () => {
    expect(
      currentStockLines(
        [
          { outOfStock: false, quantity: 99, sku: "S1", source: "east" },
          { outOfStock: false, quantity: 99, sku: "S1", source: "default" },
        ],
        products,
      ),
    ).toEqual([
      { outOfStock: false, quantity: 7, sku: "S1", source: "east" },
      { outOfStock: true, quantity: 0, sku: "S1", source: "default" },
    ]);
  });

  test("drops a line whose product or warehouse the ERP no longer has", () => {
    expect(
      currentStockLines(
        [
          { outOfStock: false, quantity: 1, sku: "GONE", source: "default" },
          { outOfStock: false, quantity: 1, sku: "S1", source: "west" },
        ],
        products,
      ),
    ).toEqual([]);
  });
});

describe("currentProducts", () => {
  test("reads each SKU once", async () => {
    erp.product.mockResolvedValue({
      data: { warehouses: [] },
      ok: true,
      status: 200,
    });
    const map = await currentProducts({}, [
      { sku: "S1", source: "a" },
      { sku: "S1", source: "b" },
      { sku: "S2", source: "a" },
    ]);
    expect(erp.product).toHaveBeenCalledTimes(2);
    expect([...map.keys()]).toEqual(["S1", "S2"]);
  });
});
