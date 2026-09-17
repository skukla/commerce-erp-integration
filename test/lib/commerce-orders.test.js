/*
 * The Commerce order calls the order event uses: find an order by the number a shopper
 * sees, and write the ERP number onto it. The client is a stand-in recording each request.
 */
const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}));
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ get: mockGet, post: mockPost })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import {
  clearExtOrderId,
  findOrderByIncrementId,
  setExtOrderId,
} from "#lib/commerce";

const answer = (body) => ({ json: () => Promise.resolve(body) });

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the Commerce order calls", () => {
  test("Then an order is found by its increment id, one result asked for", async () => {
    mockGet.mockReturnValueOnce(
      answer({
        items: [{ entity_id: "41", ext_order_id: null, store_id: "3" }],
      }),
    );
    expect(await findOrderByIncrementId({}, "3000000004")).toStrictEqual({
      entityId: 41,
      extOrderId: null,
      storeId: 3,
    });
    const [path, { searchParams }] = mockGet.mock.calls[0];
    expect(path).toBe("orders");
    expect(searchParams).toMatchObject({
      "searchCriteria[filter_groups][0][filters][0][field]": "increment_id",
      "searchCriteria[filter_groups][0][filters][0][value]": "3000000004",
      "searchCriteria[pageSize]": "1",
    });
  });

  test("Then an unknown number is null", async () => {
    mockGet.mockReturnValueOnce(answer({ items: [] }));
    expect(await findOrderByIncrementId({}, "nope")).toBeNull();
  });

  test("Then the ERP number is written with a sparse order save, and clearing writes an empty one", async () => {
    mockPost.mockReturnValue(answer({}));
    await setExtOrderId({}, "41", "0000001002");
    await clearExtOrderId({}, 41);
    expect(mockPost.mock.calls).toStrictEqual([
      [
        "orders",
        { json: { entity: { entity_id: 41, ext_order_id: "0000001002" } } },
      ],
      ["orders", { json: { entity: { entity_id: 41, ext_order_id: "" } } }],
    ]);
  });
});
