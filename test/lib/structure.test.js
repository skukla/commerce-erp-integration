import {
  orderPrefix,
  ownershipFilter,
  ownsSku,
  salesOrgOf,
  splitExtOrderId,
  structureFrom,
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

describe("Given the sales organisation of an order", () => {
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
  test("Then all owns every product; sources owns what is stocked in the named sources; attribute owns what names this ERP", () => {
    expect(ownershipFilter({}).owns({ sourceCodes: [] })).toBe(true);
    const bySource = ownershipFilter({
      structure_owns: "sources",
      structure_owns_sources: "east, west",
    });
    expect(bySource.owns({ sourceCodes: ["default", "east"] })).toBe(true);
    expect(bySource.owns({ sourceCodes: ["default"] })).toBe(false);
    expect(bySource.describe).toBe("products stocked in east, west");
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
      structure_owns: "sources",
      structure_owns_sources: "",
    });
    expect(blank.owns({ sourceCodes: ["default"] })).toBe(false);
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
      sourceCodesOf: vi.fn(async () => ["east"]),
    };
    expect(await ownsSku({}, "A1", {}, readers)).toBe(true);
    expect(readers.sourceCodesOf).not.toHaveBeenCalled();
    expect(
      await ownsSku(
        {},
        "A1",
        { structure_owns: "sources", structure_owns_sources: "east" },
        readers,
      ),
    ).toBe(true);
    expect(
      await ownsSku(
        {},
        "A1",
        { structure_owns: "sources", structure_owns_sources: "west" },
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

describe("Given the structure block the mirror sends", () => {
  test("Then each website carries its sales organisation from its setting, its currency and country from the store config, and nulls for what REST does not give", () => {
    const block = structureFrom(
      [
        { code: "base", id: 1, name: "Main Website" },
        { code: "eu", id: 2, name: "Europe" },
      ],
      new Map([
        [1, { currency: "USD", locale: "en_US" }],
        [2, { currency: "EUR", locale: "de_DE" }],
      ]),
      new Map([
        [
          2,
          {
            structure_sales_org: "2000",
            structure_sales_org_name: "Online EU",
          },
        ],
      ]),
    );
    expect(block).toEqual({
      websites: [
        {
          code: "base",
          name: "Main Website",
          salesOrg: "1000",
          salesOrgName: null,
          storeInfo: {
            address: null,
            countryId: "US",
            currency: "USD",
            vatNumber: null,
          },
        },
        {
          code: "eu",
          name: "Europe",
          salesOrg: "2000",
          salesOrgName: "Online EU",
          storeInfo: {
            address: null,
            countryId: "DE",
            currency: "EUR",
            vatNumber: null,
          },
        },
      ],
    });
  });
});
