/* Which ERP owns a product (src/router/ownership.js): an ERP's own ownership setting, else its erp_owner id. */
import { ownsLine } from "#lib/structure";
import {
  OWNER_ATTRIBUTE,
  ownershipOf,
  ownersOf,
  ownersOfLine,
} from "#router/ownership";

describe("Given an ERP entry", () => {
  test("Then with no settings of its own it owns the products whose erp_owner names it", () => {
    expect(ownershipOf({ id: "brand-a" })).toEqual({
      structure_owns: "attribute",
      structure_owns_attribute: `${OWNER_ATTRIBUTE}=brand-a`,
    });
  });

  test("Then its own ownership setting wins", () => {
    expect(
      ownershipOf({
        id: "brand-a",
        settings: {
          structure_order_prefix: "BRA",
          structure_owns: "attribute",
          structure_owns_attribute: "erp_owner=BRA",
        },
      }),
    ).toEqual({
      structure_owns: "attribute",
      structure_owns_attribute: "erp_owner=BRA",
    });
  });

  test("Then its websites setting is carried with the mode", () => {
    expect(
      ownershipOf({
        id: "brand-a",
        settings: {
          structure_owns: "websites",
          structure_owns_websites: "base",
        },
      }),
    ).toEqual({ structure_owns: "websites", structure_owns_websites: "base" });
  });
});

/*
 * Owner, 2026-10-02: a product rule (attribute, inventory source, all) beats a website rule.
 * The website rule is the catch-all for that site.
 */
describe("Given a website ERP A on base and an attribute ERP B", () => {
  const A = {
    id: "a",
    settings: { structure_owns: "websites", structure_owns_websites: "base" },
  };
  const B = { id: "b" };
  /** The real rule over a fake product read: TAGGED names B, nothing else is tagged. */
  const owns = (p, sku, settings, websiteCode) =>
    ownsLine(p, { sku, websiteCode }, settings, {
      productAttributes: async (_p, s) =>
        s === "TAGGED" ? { erp_owner: "b" } : {},
      sourceCodesOf: async () => [],
      websiteCodesOf: async () => ["eu"],
    });

  test("Then on an order from base a line B's attribute names is B's alone, and an untagged line is A's", async () => {
    expect(
      await ownersOfLine(
        {},
        { sku: "TAGGED", websiteCode: "base" },
        [A, B],
        owns,
      ),
    ).toEqual(["b"]);
    expect(
      await ownersOfLine(
        {},
        { sku: "PLAIN", websiteCode: "base" },
        [A, B],
        owns,
      ),
    ).toEqual(["a"]);
  });

  test("Then on an order from another website an untagged line has no owner", async () => {
    expect(
      await ownersOfLine({}, { sku: "PLAIN", websiteCode: "us" }, [A, B], owns),
    ).toEqual([]);
  });

  test("Then two product-rule ERPs claiming a line are both its owners, and the website ERP is not", async () => {
    const C = { id: "c", settings: { structure_owns: "all" } };
    expect(
      await ownersOfLine(
        {},
        { sku: "TAGGED", websiteCode: "base" },
        [A, B, C],
        owns,
      ),
    ).toEqual(["b", "c"]);
  });

  test("Then a SKU asked about on its own is the website ERP's by the websites it is sold on", async () => {
    expect(await ownersOf({}, "PLAIN", [A, B], owns)).toEqual([]);
    const onBase = {
      ...A,
      settings: { ...A.settings, structure_owns_websites: "base, eu" },
    };
    expect(await ownersOf({}, "PLAIN", [onBase, B], owns)).toEqual(["a"]);
  });
});
