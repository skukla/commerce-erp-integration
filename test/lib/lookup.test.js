/*
 * "What do you hold for SKU X / company Y?" — both systems' records for one entity, side
 * by side, in the rows the Mapping tab prints (programme plan §6 row 9: a small read on the
 * pair so the ERP side of a card is live). Pure: the action fetches, this arranges.
 */
import { companyLookup, productLookup } from "#lib/lookup";

const COMMERCE_PRODUCT = {
  name: "Canvas tote",
  price: 12,
  sku: "P000003",
  status: 1,
  type_id: "simple",
};

const ERP_PRODUCT = {
  available: 15,
  committed: 3,
  listPrice: 12,
  name: "Canvas tote",
  salesStatus: "sellable",
  sku: "P000003",
  stock: 18,
  type: "simple",
  unit: "EA",
  warehouses: [
    { code: "default", name: "Default Source", quantity: 18 },
    { code: "east", name: "East DC", quantity: 0 },
  ],
};

const COMMERCE_COMPANY = {
  company_name: "Fabrikam Retail",
  id: 9,
  legal_name: "Fabrikam Retail GmbH",
  status: 1,
  vat_tax_id: "DE 812345678",
};

const COMMERCE_CREDIT = {
  balance: -723,
  credit_limit: 25_000,
  currency_code: "EUR",
};

const ERP_PARTNER = {
  blocking: "all",
  commerceCompanyId: "9",
  credit: { available: 24_277, exposure: 723, limit: 25_000 },
  creditLimit: 25_000,
  id: "C000103",
  legalName: "Fabrikam Retail GmbH",
  name: "Fabrikam Retail",
  paymentTerms: "NET15",
  salesOrgs: ["2000"],
  vatTaxId: "DE 812345678",
};

describe("Given a SKU asked of both systems", () => {
  test("Then the answer says who has it and lines the two records up row by row", () => {
    const answer = productLookup({
      commerce: COMMERCE_PRODUCT,
      erp: ERP_PRODUCT,
      sku: "P000003",
      sourceCodes: ["default", "east"],
    });
    expect(answer.kind).toBe("product");
    expect(answer.key).toBe("P000003");
    expect(answer.found).toStrictEqual({ commerce: true, erp: true });
    expect(answer.rows).toStrictEqual([
      { commerce: "Canvas tote", erp: "Canvas tote", label: "Name" },
      { commerce: "simple", erp: "simple · EA", label: "Type" },
      { commerce: "12", erp: "12", label: "Price" },
      { commerce: "enabled", erp: "sellable", label: "Status" },
      {
        commerce: "in sources default, east",
        erp: "default 18, east 0",
        label: "Stock",
      },
      {
        commerce: null,
        erp: "18 on hand · 3 committed · 15 available",
        label: "Availability",
      },
    ]);
    expect(answer.erpHash).toBe("#products?open=P000003");
  });

  test("Then a side that does not have it shows dashes, and the ERP link is absent without the ERP record", () => {
    const answer = productLookup({
      commerce: COMMERCE_PRODUCT,
      erp: null,
      sku: "P000003",
      sourceCodes: [],
    });
    expect(answer.found).toStrictEqual({ commerce: true, erp: false });
    expect(answer.rows.every((row) => row.erp === null)).toBe(true);
    expect(answer.rows[4].commerce).toBe("in no source");
    expect(answer.erpHash).toBeNull();
    const neither = productLookup({ commerce: null, erp: null, sku: "X" });
    expect(neither.found).toStrictEqual({ commerce: false, erp: false });
    expect(
      neither.rows.every((row) => row.commerce === null && row.erp === null),
    ).toBe(true);
  });
});

describe("Given a company asked of both systems", () => {
  test("Then the answer lines up identity, status, credit and the ERP's own fields", () => {
    const answer = companyLookup({
      commerce: COMMERCE_COMPANY,
      companyId: "9",
      credit: COMMERCE_CREDIT,
      erp: ERP_PARTNER,
    });
    expect(answer.kind).toBe("company");
    expect(answer.key).toBe("9");
    expect(answer.found).toStrictEqual({ commerce: true, erp: true });
    expect(answer.rows).toStrictEqual([
      {
        commerce: "Fabrikam Retail",
        erp: "Fabrikam Retail (C000103)",
        label: "Name",
      },
      { commerce: "active", erp: "blocked for all business", label: "Status" },
      { commerce: "25000 EUR", erp: "25000", label: "Credit limit" },
      {
        commerce: "balance -723",
        erp: "exposure 723 · available 24277",
        label: "Credit position",
      },
      {
        commerce: "Fabrikam Retail GmbH",
        erp: "Fabrikam Retail GmbH",
        label: "Legal name",
      },
      { commerce: "DE 812345678", erp: "DE 812345678", label: "VAT / tax id" },
      { commerce: null, erp: "NET15", label: "Payment terms" },
      { commerce: null, erp: "2000", label: "Sales organisations" },
    ]);
    expect(answer.erpHash).toBe("#partners?open=C000103");
  });

  test("Then a blocked Commerce company and a partner with no credit read plainly", () => {
    const answer = companyLookup({
      commerce: { ...COMMERCE_COMPANY, status: 3 },
      companyId: "9",
      credit: null,
      erp: { ...ERP_PARTNER, blocking: "open", credit: null },
    });
    expect(answer.rows[1]).toStrictEqual({
      commerce: "blocked",
      erp: "open",
      label: "Status",
    });
    expect(answer.rows[2]).toStrictEqual({
      commerce: null,
      erp: "25000",
      label: "Credit limit",
    });
    expect(answer.rows[3]).toStrictEqual({
      commerce: null,
      erp: null,
      label: "Credit position",
    });
  });
});
