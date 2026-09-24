/*
 * What Commerce held BEFORE the ERP overwrote it. Commerce is the permanent system in a
 * demo and the ERP is transient (owner, 2026-09-23), so a price or a stock level the ERP
 * decides has to be put back when the integration is removed — and that is only possible
 * if the previous value was read first.
 */
const mockGet = vi.fn();
vi.mock("#lib/commerce", () => ({
  commerceClient: vi.fn(async () => ({ get: mockGet })),
  listWebsites: vi.fn(async () => []),
  productAttributes: vi.fn(async () => ({})),
  sourceCodesOf: vi.fn(async () => []),
  storeConfigs: vi.fn(async () => new Map()),
}));

import { nameOf, priceOf, quantityOf } from "#lib/commerce-before";

const json = (value) => ({ json: () => Promise.resolve(value) });

afterEach(() => vi.clearAllMocks());

describe("Given the price Commerce holds for a SKU", () => {
  test("Then it is read as a number", async () => {
    mockGet.mockReturnValue(json({ price: 120.5, sku: "A1" }));

    expect(await priceOf({}, "A1")).toBe(120.5);
    expect(mockGet).toHaveBeenCalledWith("products/A1");
  });

  test("Then a SKU Commerce does not have is undefined, not zero", async () => {
    mockGet.mockImplementation(() => {
      throw new Error("404");
    });

    expect(await priceOf({}, "nope")).toBeUndefined();
  });

  // A price of 0 is a real price and must not be read as "no answer".
  test("Then zero is a price", async () => {
    mockGet.mockReturnValue(json({ price: 0, sku: "A1" }));

    expect(await priceOf({}, "A1")).toBe(0);
  });

  test("Then a SKU with characters a URL would swallow is escaped", async () => {
    mockGet.mockReturnValue(json({ price: 1, sku: "A/1" }));

    await priceOf({}, "A/1");

    expect(mockGet).toHaveBeenCalledWith("products/A%2F1");
  });
});

describe("Given the name Commerce holds for a SKU", () => {
  test("Then it is read as the string to put back", async () => {
    mockGet.mockReturnValue(json({ name: "Commerce wording", sku: "A1" }));

    expect(await nameOf({}, "A1")).toBe("Commerce wording");
    expect(mockGet).toHaveBeenCalledWith("products/A1");
  });

  // An empty name is not a value anyone wants restored, and it is not an answer.
  test("Then an empty or absent name is undefined, so nothing is put back", async () => {
    mockGet.mockReturnValue(json({ name: "", sku: "A1" }));
    expect(await nameOf({}, "A1")).toBeUndefined();

    mockGet.mockReturnValue(json({ sku: "A1" }));
    expect(await nameOf({}, "A1")).toBeUndefined();
  });

  test("Then a read that fails is undefined rather than a guess", async () => {
    mockGet.mockImplementation(() => {
      throw new Error("500");
    });

    expect(await nameOf({}, "A1")).toBeUndefined();
  });
});

describe("Given the quantity Commerce holds for a SKU at one source", () => {
  test("Then that source's row is the answer", async () => {
    mockGet.mockReturnValue(
      json({ items: [{ quantity: 7, sku: "A1", source_code: "east" }] }),
    );

    expect(await quantityOf({}, "A1", "east")).toBe(7);
  });

  test("Then a source with no row is undefined, so nothing is put back", async () => {
    mockGet.mockReturnValue(json({ items: [] }));

    expect(await quantityOf({}, "A1", "west")).toBeUndefined();
  });

  test("Then a read that fails is undefined rather than a guess", async () => {
    mockGet.mockImplementation(() => {
      throw new Error("503");
    });

    expect(await quantityOf({}, "A1", "east")).toBeUndefined();
  });
});
