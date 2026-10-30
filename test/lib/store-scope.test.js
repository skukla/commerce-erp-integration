/*
 * Which store views a store-scoped close covers (owner, 2026-10-30): Demo Builder's store wipe
 * names stores (Commerce's store groups) and websites by code, as its own wipe scope does; a
 * website names all of its stores, a store all of its views. An order names its view in
 * `store_id`. Pure, over the three lists Commerce answers (store/websites, store/storeGroups,
 * store/storeViews).
 */
import { scopeOf, viewsInScope } from "#lib/store-scope";

const STRUCTURE = {
  storeGroups: [
    { code: "main_website_store", id: 1, website_id: 1 },
    { code: "outlet_store", id: 3, website_id: 1 },
    { code: "eu_store", id: 2, website_id: 2 },
  ],
  storeViews: [
    { code: "default", id: 1, store_group_id: 1, website_id: 1 },
    { code: "outlet_en", id: 4, store_group_id: 3, website_id: 1 },
    { code: "eu_en", id: 2, store_group_id: 2, website_id: 2 },
  ],
  websites: [
    { code: "admin", id: 0 },
    { code: "base", id: 1 },
    { code: "eu", id: 2 },
  ],
};

describe("Given a scope of store and website codes", () => {
  test("Then a store names only its own views", () => {
    expect(viewsInScope(STRUCTURE, { stores: ["outlet_store"] })).toEqual({
      unknown: [],
      viewIds: [4],
    });
  });

  test("Then a website names every view of every one of its stores", () => {
    expect(viewsInScope(STRUCTURE, { websites: ["base"] }).viewIds).toEqual([
      1, 4,
    ]);
  });

  test("Then stores and websites together name each view once", () => {
    expect(
      viewsInScope(STRUCTURE, {
        stores: ["eu_store", "outlet_store"],
        websites: ["base"],
      }).viewIds,
    ).toEqual([1, 2, 4]);
  });

  test("Then a code the store does not have is named, never guessed (the Admin website is not one)", () => {
    expect(
      viewsInScope(STRUCTURE, { stores: ["nope"], websites: ["admin", "eu"] }),
    ).toEqual({ unknown: ["store nope", "website admin"], viewIds: [2] });
  });

  test("Then a website with no stores names no view, and that is not an error", () => {
    const empty = {
      ...STRUCTURE,
      websites: [...STRUCTURE.websites, { code: "bare", id: 9 }],
    };
    expect(viewsInScope(empty, { websites: ["bare"] })).toEqual({
      unknown: [],
      viewIds: [],
    });
  });
});

describe("Given the params a caller sends", () => {
  test("Then a body's lists and a query's comma-separated codes read the same", () => {
    expect(scopeOf({ stores: ["a", "b"], websites: "base, eu" })).toEqual({
      stores: ["a", "b"],
      websites: ["base", "eu"],
    });
  });

  test("Then nothing named is an empty scope", () => {
    expect(scopeOf({})).toEqual({ stores: [], websites: [] });
    expect(scopeOf({ stores: "", websites: [] })).toEqual({
      stores: [],
      websites: [],
    });
  });
});
