/*
 * Credit per ERP (design v1 §3.1, demo scope): each ERP's limit (and exposure and available
 * credit when it sends them) lives in company custom attributes prefixed by the ERP id, and
 * Commerce's company credit limit is the total across the ERPs. Every write is ledgered so
 * detach can put it back.
 */
import { applyErpCredit, attributeCode } from "#lib/erp-credit";

const ERPS = [{ id: "cabinets" }, { id: "sign-erp" }];

function deps(attributes = []) {
  const written = [];
  return {
    erps: ERPS,
    getCompany: vi.fn(async () => ({ custom_attributes: attributes, id: 7 })),
    getCompanyCredit: vi.fn(async () => ({ credit_limit: 500, id: 42 })),
    recordCompanyWrite: vi.fn(async () => []),
    setCompanyCreditLimit: vi.fn(async () => ({})),
    setCompanyCustomAttributes: vi.fn((_p, _id, attrs) => {
      written.push(attrs);
      return Promise.resolve();
    }),
    written,
  };
}

describe("Given two ERPs setting a company's credit", () => {
  test("Then the attribute code is prefixed by the ERP id, in Commerce's attribute alphabet", () => {
    expect(attributeCode("sign-erp", "credit_limit")).toBe(
      "erp_sign_erp_credit_limit",
    );
  });

  test("Then an ERP's limit is written to its own attribute, the whole set is kept, and Commerce's limit is the total", async () => {
    const d = deps([
      { attribute_code: "erp_cabinets_credit_limit", value: "1000" },
      { attribute_code: "unrelated", value: "x" },
    ]);
    const result = await applyErpCredit(
      {},
      {
        available: 250,
        companyId: "7",
        creditLimit: 400,
        erpId: "sign-erp",
        exposure: 150,
      },
      d,
    );
    expect(d.written[0]).toEqual([
      { attribute_code: "erp_cabinets_credit_limit", value: "1000" },
      { attribute_code: "unrelated", value: "x" },
      { attribute_code: "erp_sign_erp_credit_limit", value: "400" },
      { attribute_code: "erp_sign_erp_exposure", value: "150" },
      { attribute_code: "erp_sign_erp_available", value: "250" },
    ]);
    expect(d.setCompanyCreditLimit).toHaveBeenCalledWith({}, 42, "7", 1400);
    expect(result).toEqual({ total: 1400 });
  });

  test("Then both writes are ledgered with what Commerce had before, so detach can put them back", async () => {
    const before = [{ attribute_code: "unrelated", value: "x" }];
    const d = deps(before);
    await applyErpCredit(
      {},
      { companyId: "7", creditLimit: 300, erpId: "cabinets" },
      d,
    );
    expect(d.recordCompanyWrite).toHaveBeenCalledWith({
      after: [
        ...before,
        { attribute_code: "erp_cabinets_credit_limit", value: "300" },
      ],
      before,
      companyId: "7",
      field: "customAttributes",
    });
    expect(d.recordCompanyWrite).toHaveBeenCalledWith({
      after: 300,
      before: 500,
      companyId: "7",
      extra: { creditId: 42 },
      field: "creditLimit",
    });
  });

  test("Then an attribute of an ERP no longer in the list does not count toward the total", async () => {
    const d = deps([
      { attribute_code: "erp_gone_credit_limit", value: "9000" },
    ]);
    expect(
      await applyErpCredit(
        {},
        { companyId: "7", creditLimit: 100, erpId: "cabinets" },
        d,
      ),
    ).toEqual({ total: 100 });
  });
});
