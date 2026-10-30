/*
 * The reads a store-scoped close makes (lib/commerce-store-scope.js): the request each sends, as
 * Commerce's search criteria name it. The websites body is the live capture (Bodea, 2026-09-27);
 * the order search's `in` condition and `fields` are NOT captured live.
 */
import { readFileSync } from "node:fs";

const mockGet = vi.fn();
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ get: mockGet })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import { orderIdsInViews, readStoreStructure } from "#lib/commerce-store-scope";

const answer = (body) => ({ json: async () => body });
const websites = JSON.parse(
  readFileSync(
    new URL("../fixtures/commerce/websites.json", import.meta.url),
    "utf8",
  ),
).body;

afterEach(() => vi.clearAllMocks());

describe("Given a store-scoped close's reads", () => {
  test("Then the structure is the store's three lists, as Commerce answers them", async () => {
    const views = [{ code: "default", id: 1, store_group_id: 1 }];
    const groups = [{ code: "main_website_store", id: 1, website_id: 1 }];
    mockGet.mockImplementation((path) =>
      answer(
        {
          "store/storeGroups": groups,
          "store/storeViews": views,
          "store/websites": websites,
        }[path],
      ),
    );
    expect(await readStoreStructure({})).toEqual({
      storeGroups: groups,
      storeViews: views,
      websites,
    });
  });

  test("Then the orders are searched by store view, every page, only their ids and views", async () => {
    mockGet.mockReturnValueOnce(
      answer({
        items: [
          { entity_id: 701, store_id: 1 },
          { entity_id: 702, store_id: 4 },
        ],
        total_count: 2,
      }),
    );
    expect(await orderIdsInViews({}, [1, 4])).toEqual(["701", "702"]);
    const [path, { searchParams }] = mockGet.mock.calls[0];
    expect(path).toBe("orders");
    expect(searchParams).toMatchObject({
      fields: "items[entity_id,store_id],total_count",
      "searchCriteria[filter_groups][0][filters][0][condition_type]": "in",
      "searchCriteria[filter_groups][0][filters][0][field]": "store_id",
      "searchCriteria[filter_groups][0][filters][0][value]": "1,4",
    });
  });

  test("Then no views asks Commerce nothing", async () => {
    expect(await orderIdsInViews({}, [])).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
