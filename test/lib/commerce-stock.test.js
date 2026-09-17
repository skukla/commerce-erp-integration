/*
 * The two inventory readers the mirror uses: stock per source, and source names.
 * The Commerce client is a stand-in answering the REST paths the readers ask for.
 */
const mockGet = vi.fn();
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ get: mockGet })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import { listSources, listStock } from "#lib/commerce";

/** Answer one page per path, then an empty page. */
function pages(byPath) {
  mockGet.mockImplementation((path, options) => ({
    json: () => {
      const page = Number(options.searchParams["searchCriteria[currentPage]"]);
      const answer = byPath[path];
      if (answer instanceof Error) {
        return Promise.reject(answer);
      }
      const items = page === 1 ? answer : [];
      return Promise.resolve({ items, total_count: answer.length });
    },
  }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the store's inventory", () => {
  test("Then stock is kept per source, not added up, and quantities are whole", async () => {
    pages({
      "inventory/source-items": [
        { quantity: 120, sku: "T1", source_code: "default" },
        { quantity: 25.4, sku: "T1", source_code: "austin_dc" },
        { quantity: -3, sku: "T2", source_code: "default" },
      ],
    });
    const stock = await listStock({});
    expect(stock.get("T1")).toEqual([
      { code: "default", quantity: 120 },
      { code: "austin_dc", quantity: 25 },
    ]);
    expect(stock.get("T2")).toEqual([{ code: "default", quantity: 0 }]);
  });

  test("Then sources are named by code", async () => {
    pages({
      "inventory/sources": [
        { name: "Default Source", source_code: "default" },
        { name: "Austin DC", source_code: "austin_dc" },
      ],
    });
    expect(await listSources({})).toEqual(
      new Map([
        ["default", "Default Source"],
        ["austin_dc", "Austin DC"],
      ]),
    );
  });

  test("Then a store without the sources API answers no names, and other failures are errors", async () => {
    pages({
      "inventory/sources": Object.assign(new Error("not found"), {
        response: { status: 404 },
      }),
    });
    expect(await listSources({})).toEqual(new Map());
    pages({
      "inventory/sources": Object.assign(new Error("denied"), {
        response: { status: 401 },
      }),
    });
    await expect(listSources({})).rejects.toThrow("denied");
  });
});
