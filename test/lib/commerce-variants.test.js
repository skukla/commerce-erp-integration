/*
 * The reader the router's variant check uses: a configurable product's SKU and its variants'
 * SKUs, from the product id an order line carries. The client is a stand-in answering REST paths.
 */
const mockGet = vi.fn();
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ get: mockGet })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import { variantsOfProduct } from "#lib/commerce";

afterEach(() => {
  vi.clearAllMocks();
});

function answers(byPath) {
  mockGet.mockImplementation((path) => ({
    json: () =>
      byPath[path] === undefined
        ? Promise.reject(new Error(`no answer for ${path}`))
        : Promise.resolve(byPath[path]),
  }));
}

describe("Given a configurable product's id", () => {
  test("Then its SKU and its variants' SKUs are read", async () => {
    answers({
      "configurable-products/CAB%201/children": [
        { sku: "CAB-RED" },
        { sku: "CAB-BLUE" },
      ],
      products: { items: [{ sku: "CAB 1" }] },
    });
    await expect(variantsOfProduct({}, 70)).resolves.toStrictEqual({
      parentSku: "CAB 1",
      skus: ["CAB-RED", "CAB-BLUE"],
    });
    expect(mockGet.mock.calls[0][1].searchParams).toMatchObject({
      "searchCriteria[filter_groups][0][filters][0][value]": "70",
    });
  });

  test("Then a product Commerce does not know has no variants", async () => {
    answers({ products: { items: [] } });
    await expect(variantsOfProduct({}, 99)).resolves.toStrictEqual({
      parentSku: null,
      skus: [],
    });
  });
});
