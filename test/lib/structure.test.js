import {
  OWNS,
  orderPrefix,
  ownershipFilter,
  ownsLine,
  ownsSku,
  salesOrgOf,
  splitExtOrderId,
  withPrefix,
} from "#lib/structure";

const BLANK = /the setting is blank/u;

describe("Given the order-number prefix (rule M4)", () => {
  test("Then the setting wins, else the ERP's name gives the first four letters and digits, else ERP", () => {
    expect(
      orderPrefix(
        { structure_order_prefix: "NW" },
        { ERP_DISPLAY_NAME: "Northwind ERP" },
      ),
    ).toBe("NW");
    expect(
      orderPrefix(
        { structure_order_prefix: "" },
        { ERP_DISPLAY_NAME: "Northwind ERP" },
      ),
    ).toBe("NORT");
    expect(orderPrefix({}, { ERP_DISPLAY_NAME: "Acme ERP" })).toBe("ACME");
    expect(orderPrefix({}, { ERP_DISPLAY_NAME: "B2 Co" })).toBe("B2CO");
    expect(orderPrefix(undefined, {})).toBe("ERP");
    expect(orderPrefix({ structure_order_prefix: "too-long-prefix" }, {})).toBe(
      "ERP",
    );
  });
  test("Then a number is written with the prefix and read back without it; a number from before prefixes has none", () => {
    expect(withPrefix("0000001042", "ACME")).toBe("ACME-0000001042");
    expect(splitExtOrderId("ACME-0000001042")).toEqual({
      number: "0000001042",
      prefix: "ACME",
    });
    expect(splitExtOrderId("0000001042")).toEqual({
      number: "0000001042",
      prefix: null,
    });
    expect(splitExtOrderId("")).toEqual({ number: null, prefix: null });
    expect(splitExtOrderId(null)).toEqual({ number: null, prefix: null });
    expect(splitExtOrderId("SAP-12")).toEqual({ number: null, prefix: null });
  });
});

describe("Given the sales organization of an order", () => {
  test("Then the website's setting names it, with its name when one is set, else 1000 alone", () => {
    expect(
      salesOrgOf({
        structure_sales_org: "2000",
        structure_sales_org_name: "Online EU",
      }),
    ).toEqual({ salesOrg: "2000", salesOrgName: "Online EU" });
    expect(
      salesOrgOf({ structure_sales_org: "2000", structure_sales_org_name: "" }),
    ).toEqual({ salesOrg: "2000" });
    expect(salesOrgOf({})).toEqual({ salesOrg: "1000" });
    expect(salesOrgOf(undefined)).toEqual({ salesOrg: "1000" });
  });
});

describe("Given which products belong to this ERP (rule M3)", () => {
  test("Then all owns every product; attribute owns what names this ERP; the deleted sources mode reads as all", () => {
    expect(ownershipFilter({}).owns({})).toBe(true);
    // Deleted 2026-10-09 (Demo Builder AB-70): an entry still carrying it owns everything.
    const bySource = ownershipFilter({
      structure_owns: "sources",
      structure_owns_sources: "east, west",
    });
    expect(bySource.mode).toBe(OWNS.ALL);
    expect(bySource.owns({ customAttributes: {} })).toBe(true);
    const byAttribute = ownershipFilter({
      structure_owns: "attribute",
      structure_owns_attribute: "erp_owner=ACME",
    });
    expect(byAttribute.owns({ customAttributes: { erp_owner: "ACME" } })).toBe(
      true,
    );
    expect(byAttribute.owns({ customAttributes: { erp_owner: "NW" } })).toBe(
      false,
    );
    expect(byAttribute.owns({})).toBe(false);
    expect(byAttribute.describe).toBe("products whose erp_owner is ACME");
  });
  test("Then a mode with a blank setting owns nothing, and says so", () => {
    const blank = ownershipFilter({
      structure_owns: "websites",
      structure_owns_websites: "",
    });
    expect(blank.owns({ websiteCodes: ["base"] })).toBe(false);
    expect(blank.describe).toMatch(BLANK);
    expect(
      ownershipFilter({ structure_owns: "attribute" }).owns({
        customAttributes: { erp_owner: "X" },
      }),
    ).toBe(false);
  });
  test("Then a SKU named by an event is asked of Commerce only when the mode needs it", async () => {
    const readers = {
      productAttributes: vi.fn(async () => ({ erp_owner: "ACME" })),
      websiteCodesOf: vi.fn(async () => ["eu"]),
    };
    expect(await ownsSku({}, "A1", {}, readers)).toBe(true);
    expect(readers.productAttributes).not.toHaveBeenCalled();
    expect(readers.websiteCodesOf).not.toHaveBeenCalled();
    expect(
      await ownsSku(
        {},
        "A1",
        { structure_owns: "websites", structure_owns_websites: "eu" },
        readers,
      ),
    ).toBe(true);
    expect(readers.productAttributes).not.toHaveBeenCalled();
    expect(
      await ownsSku(
        {},
        "A1",
        { structure_owns: "websites", structure_owns_websites: "us" },
        readers,
      ),
    ).toBe(false);
    expect(
      await ownsSku(
        {},
        "A1",
        {
          structure_owns: "attribute",
          structure_owns_attribute: "erp_owner=ACME",
        },
        readers,
      ),
    ).toBe(true);
    expect(
      await ownsSku(
        {},
        "A1",
        {
          structure_owns: "attribute",
          structure_owns_attribute: "erp_owner=NW",
        },
        readers,
      ),
    ).toBe(false);
  });
});

describe("Given an ERP that owns the products sold on named websites (AB-64)", () => {
  const onBase = {
    structure_owns: "websites",
    structure_owns_websites: "base, eu",
  };
  test("Then the filter owns a product by the websites it is sold on, and says which", () => {
    const byWebsite = ownershipFilter(onBase);
    expect(byWebsite.mode).toBe(OWNS.WEBSITES);
    expect(byWebsite.owns({ websiteCodes: ["eu"] })).toBe(true);
    expect(byWebsite.owns({ websiteCodes: ["us"] })).toBe(false);
    expect(byWebsite.owns({})).toBe(false);
    expect(byWebsite.describe).toBe("products sold on base, eu");
    const blank = ownershipFilter({ structure_owns: "websites" });
    expect(blank.owns({ websiteCodes: ["base"] })).toBe(false);
    expect(blank.describe).toMatch(BLANK);
  });
  test("Then a line with the order's website is decided by that website, with no read", async () => {
    const readers = {
      productAttributes: vi.fn(async () => ({})),
      sourceCodesOf: vi.fn(async () => []),
      websiteCodesOf: vi.fn(async () => ["us"]),
    };
    expect(
      await ownsLine({}, { sku: "A1", websiteCode: "eu" }, onBase, readers),
    ).toBe(true);
    expect(
      await ownsLine({}, { sku: "A1", websiteCode: "us" }, onBase, readers),
    ).toBe(false);
    expect(readers.websiteCodesOf).not.toHaveBeenCalled();
  });
  test("Then a SKU with no order website is decided by the websites the product is sold on", async () => {
    const readers = {
      productAttributes: vi.fn(async () => ({})),
      sourceCodesOf: vi.fn(async () => []),
      websiteCodesOf: vi.fn(async () => ["us", "eu"]),
    };
    expect(await ownsSku({}, "A1", onBase, readers)).toBe(true);
    expect(readers.websiteCodesOf).toHaveBeenCalledWith({}, "A1");
    readers.websiteCodesOf.mockResolvedValue(["us"]);
    expect(await ownsSku({}, "A1", onBase, readers)).toBe(false);
  });
  test("Then the order's website never decides a product-rule ERP", async () => {
    const readers = {
      productAttributes: vi.fn(async () => ({ erp_owner: "NW" })),
      sourceCodesOf: vi.fn(async () => []),
    };
    expect(
      await ownsLine(
        {},
        { sku: "A1", websiteCode: "eu" },
        {
          structure_owns: "attribute",
          structure_owns_attribute: "erp_owner=ACME",
        },
        readers,
      ),
    ).toBe(false);
  });
});
