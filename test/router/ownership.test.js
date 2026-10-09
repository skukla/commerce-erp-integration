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

  test("Then two attribute ERPs claiming a line are both its owners, and the website ERP is not", async () => {
    const C = {
      id: "c",
      settings: {
        structure_owns: "attribute",
        structure_owns_attribute: "erp_owner=b",
      },
    };
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

/*
 * Owner, 2026-10-09: an ERP whose rule is `all` is the CATCH-ALL. It owns every product no
 * other ERP claims by a product rule, and never competes with an attribute ERP for a tagged
 * product. Measured on Justrite: Justrite owns `all`, Accuform owns erp_owner=accuform, and
 * an order for an Accuform sign was refused as "claimed by justrite and accuform".
 */
describe("Given Justrite owning all and Accuform owning by attribute", () => {
  const JUSTRITE = { id: "justrite", settings: { structure_owns: "all" } };
  const ACCUFORM = {
    id: "accuform",
    settings: {
      structure_owns: "attribute",
      structure_owns_attribute: "erp_owner=accuform",
    },
  };
  const owns = (p, sku, settings, websiteCode) =>
    ownsLine(p, { sku, websiteCode }, settings, {
      productAttributes: async (_p, s) =>
        s === "ACC-MADC-AL" ? { erp_owner: "accuform" } : {},
      websiteCodesOf: async () => ["base"],
    });

  test("Then a tagged product is Accuform's alone: the catch-all does not compete", async () => {
    expect(
      await ownersOfLine(
        {},
        { sku: "ACC-MADC-AL", websiteCode: "base" },
        [JUSTRITE, ACCUFORM],
        owns,
      ),
    ).toEqual(["accuform"]);
    expect(
      await ownersOf({}, "ACC-MADC-AL", [ACCUFORM, JUSTRITE], owns),
    ).toEqual(["accuform"]);
  });

  test("Then an untagged product is Justrite's alone", async () => {
    expect(
      await ownersOfLine(
        {},
        { sku: "CAB1", websiteCode: "base" },
        [JUSTRITE, ACCUFORM],
        owns,
      ),
    ).toEqual(["justrite"]);
    expect(await ownersOf({}, "CAB1", [ACCUFORM, JUSTRITE], owns)).toEqual([
      "justrite",
    ]);
  });

  test("Then two all ERPs both claim an untagged product: a setup error, as two attribute claims are", async () => {
    const SECOND = { id: "second", settings: { structure_owns: "all" } };
    expect(
      await ownersOf({}, "CAB1", [JUSTRITE, ACCUFORM, SECOND], owns),
    ).toEqual(["justrite", "second"]);
    expect(
      await ownersOf({}, "ACC-MADC-AL", [JUSTRITE, ACCUFORM, SECOND], owns),
    ).toEqual(["accuform"]);
  });

  test("Then a website ERP still comes last: the catch-all takes an untagged line from its website", async () => {
    const SITE = {
      id: "site",
      settings: { structure_owns: "websites", structure_owns_websites: "base" },
    };
    expect(
      await ownersOfLine(
        {},
        { sku: "CAB1", websiteCode: "base" },
        [SITE, ACCUFORM, JUSTRITE],
        owns,
      ),
    ).toEqual(["justrite"]);
    expect(
      await ownersOfLine(
        {},
        { sku: "CAB1", websiteCode: "base" },
        [SITE, ACCUFORM],
        owns,
      ),
    ).toEqual(["site"]);
  });
});
