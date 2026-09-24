/*
 * The lookup action: one SKU or company as both systems hold it, for the Mapping tab. The
 * collaborators are mocked; what is asserted is what the action ASKS them and how it
 * arranges the answers, including a side that does not have the entity.
 */
vi.mock("#lib/erp", () => ({
  erp: {
    partner: vi.fn(),
    partners: vi.fn(),
    product: vi.fn(),
  },
}));
vi.mock("#lib/commerce", () => ({
  getCompany: vi.fn(),
  getCompanyCredit: vi.fn(),
  getProduct: vi.fn(),
  sourceCodesOf: vi.fn(async () => []),
}));

import { readFileSync } from "node:fs";

import {
  getCompany,
  getCompanyCredit,
  getProduct,
  sourceCodesOf,
} from "#lib/commerce";
import { erp } from "#lib/erp";
import * as lookup from "#src/erp/lookup/index";

const PARAMS = { ERP_BASE_URL: "https://erp.example/api" };
const LOOKUP_CONFIG =
  /^lookup:\n {2}function: \.\/lookup\/index\.js\n {2}web: 'yes'/mu;

const notFound = () => {
  const error = new Error("404");
  error.response = { status: 404 };
  return error;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given a SKU to look up", () => {
  test("Then both systems are asked for that SKU and the answer lines them up", async () => {
    getProduct.mockResolvedValue({
      name: "Canvas tote",
      price: 12,
      sku: "P000003",
      status: 1,
      type_id: "simple",
    });
    sourceCodesOf.mockResolvedValue(["default"]);
    erp.product.mockResolvedValue({
      data: {
        available: 15,
        committed: 3,
        listPrice: 12,
        name: "Canvas tote",
        salesStatus: "sellable",
        sku: "P000003",
        stock: 18,
        type: "simple",
        unit: "EA",
        warehouses: [{ code: "default", quantity: 18 }],
      },
      ok: true,
      status: 200,
    });
    const res = await lookup.main({ ...PARAMS, sku: "P000003" });
    expect(res.statusCode).toBe(200);
    expect(getProduct).toHaveBeenCalledWith(expect.anything(), "P000003");
    expect(erp.product).toHaveBeenCalledWith(
      expect.anything(),
      "P000003",
      expect.any(Number),
    );
    expect(res.body.found).toStrictEqual({ commerce: true, erp: true });
    expect(res.body.rows[0]).toStrictEqual({
      commerce: "Canvas tote",
      erp: "Canvas tote",
      label: "Name",
    });
    expect(res.body.erpHash).toBe("#products?open=P000003");
  });

  test("Then a SKU the ERP does not have answers with an empty ERP side, not an error", async () => {
    getProduct.mockResolvedValue({
      name: "Only here",
      price: 1,
      sku: "X-1",
      status: 1,
      type_id: "simple",
    });
    erp.product.mockResolvedValue({
      data: { errorCode: "NOT_FOUND" },
      ok: false,
      status: 404,
    });
    const res = await lookup.main({ ...PARAMS, sku: "X-1" });
    expect(res.statusCode).toBe(200);
    expect(res.body.found).toStrictEqual({ commerce: true, erp: false });
    expect(res.body.erpHash).toBeNull();
  });

  test("Then an ERP that fails is an error, and a malformed SKU is refused before anyone is asked", async () => {
    erp.product.mockResolvedValue({ data: {}, ok: false, status: 503 });
    getProduct.mockResolvedValue(null);
    const failed = await lookup.main({ ...PARAMS, sku: "P1" });
    expect(failed.error.statusCode).toBe(500);
    const refused = await lookup.main({ ...PARAMS, sku: "<script>" });
    expect(refused.error.statusCode).toBe(400);
    expect(getProduct).toHaveBeenCalledTimes(1);
  });
});

describe("Given a company to look up", () => {
  test("Then Commerce is asked for the company and its credit, the ERP for the partner behind that company id", async () => {
    getCompany.mockResolvedValue({
      company_name: "Fabrikam Retail",
      id: 9,
      status: 1,
    });
    getCompanyCredit.mockResolvedValue({
      balance: 0,
      credit_limit: 25_000,
      currency_code: "EUR",
    });
    erp.partners.mockResolvedValue({
      data: {
        items: [
          { commerceCompanyId: "4", id: "C000101", name: "Northwind Trading" },
          { commerceCompanyId: "9", id: "C000103", name: "Fabrikam Retail" },
        ],
      },
      ok: true,
      status: 200,
    });
    erp.partner.mockResolvedValue({
      data: {
        blocking: "open",
        commerceCompanyId: "9",
        credit: { available: 25_000, exposure: 0, limit: 25_000 },
        creditLimit: 25_000,
        id: "C000103",
        name: "Fabrikam Retail",
        paymentTerms: "NET15",
        salesOrgs: ["2000"],
      },
      ok: true,
      status: 200,
    });
    const res = await lookup.main({ ...PARAMS, company: "9" });
    expect(res.statusCode).toBe(200);
    expect(getCompany).toHaveBeenCalledWith(expect.anything(), "9");
    expect(erp.partner).toHaveBeenCalledWith(
      expect.anything(),
      "C000103",
      expect.any(Number),
    );
    expect(res.body.rows[0]).toStrictEqual({
      commerce: "Fabrikam Retail",
      erp: "Fabrikam Retail (C000103)",
      label: "Name",
    });
    expect(res.body.rows[7]).toStrictEqual({
      commerce: null,
      erp: "2000",
      label: "Sales organisations",
    });
    expect(res.body.erpHash).toBe("#partners?open=C000103");
  });

  test("Then a company Commerce does not have (404) answers with an empty Commerce side", async () => {
    getCompany.mockRejectedValue(notFound());
    getCompanyCredit.mockRejectedValue(notFound());
    erp.partners.mockResolvedValue({
      data: { items: [] },
      ok: true,
      status: 200,
    });
    const res = await lookup.main({ ...PARAMS, company: "77" });
    expect(res.statusCode).toBe(200);
    expect(res.body.found).toStrictEqual({ commerce: false, erp: false });
    expect(erp.partner).not.toHaveBeenCalled();
  });

  test("Then the action is declared as a web action and asks for one thing or the other", async () => {
    const config = readFileSync(
      "src/commerce-extensibility-1/actions/erp/actions.config.yaml",
      "utf8",
    );
    expect(config).toMatch(LOOKUP_CONFIG);
    const res = await lookup.main(PARAMS);
    expect(res.error.statusCode).toBe(400);
  });
});
