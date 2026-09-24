import {
  orderPrefix,
  salesOrgOf,
  splitExtOrderId,
  withPrefix,
} from "#lib/structure";

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
