/*
 * The Admin lookup with several ERPs (Phase B slice B3b): a company is shown as it stands in
 * EACH ERP (its customer there, from the key map), and a SKU in the ERP that owns it. One ERP
 * is covered by lookup-action.test.js, unchanged.
 */
vi.mock("#lib/erp", () => ({
  erp: { partner: vi.fn(), partners: vi.fn(), product: vi.fn() },
}));
vi.mock("#lib/commerce", () => ({
  getCompany: vi.fn(async () => ({
    company_name: "Fabrikam",
    id: 20,
    status: 1,
  })),
  getCompanyCredit: vi.fn(async () => ({ credit_limit: 1000 })),
  getProduct: vi.fn(async (_p, sku) => ({ name: sku, sku, status: 1 })),
  productAttributes: vi.fn(async (_p, sku) => ({
    erp_owner: { CAB1: "brand-a", SIGN1: "brand-b" }[sku],
  })),
  sourceCodesOf: vi.fn(async () => []),
}));

import { getProduct, productAttributes } from "#lib/commerce";
import { erp } from "#lib/erp";
import { resetErpsClient } from "#lib/erps";
import { pairCustomer, resetKeyMapClient } from "#lib/key-map";
import * as lookup from "#src/erp/lookup/index";

const A = "https://a.example";
const B = "https://b.example";
const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: A },
    id: "brand-a",
    name: "Brand A ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: B },
    id: "brand-b",
    name: "Brand B ERP",
  },
];

/** What Commerce's client throws for a product it does not have (ky's HTTPError carries it). */
function commerceNotFound(sku) {
  const error = new Error(
    `Request failed with status code 404 Not Found: GET products/${sku}`,
  );
  error.response = { status: 404 };
  return error;
}

/** A SKU deleted from Commerce: the safe read answers null, the attribute read throws. */
function goneFromCommerce(sku) {
  getProduct.mockResolvedValueOnce(null);
  productAttributes.mockRejectedValue(commerceNotFound(sku));
}

function memoryState(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

beforeEach(() => {
  resetErpsClient(memoryState({ "erp-list": JSON.stringify(ERPS) }));
  resetKeyMapClient(memoryState());
});

afterEach(() => {
  vi.clearAllMocks();
  // Back to the factory's answer: goneFromCommerce makes the attribute read throw.
  productAttributes.mockReset();
});

describe("Given a company looked up with two ERPs", () => {
  test("Then each ERP shows its own customer for the company, asked at its own address; an ERP with no pair shows an empty side", async () => {
    await pairCustomer("20", "A-20", "brand-a");
    erp.partner.mockImplementation((params, id) =>
      Promise.resolve({
        data: { id, name: `Fabrikam at ${params.ERP_BASE_URL}` },
        ok: true,
        status: 200,
      }),
    );
    const res = await lookup.main({ company: "20" });

    expect(res.statusCode).toBe(200);
    expect(erp.partner).toHaveBeenCalledTimes(1);
    expect(erp.partner.mock.calls[0][0].ERP_BASE_URL).toBe(A);
    expect(erp.partner.mock.calls[0][1]).toBe("A-20");
    const byErp = res.body.erps.map((e) => [e.erpId, e.erpName, e.found.erp]);
    expect(byErp).toEqual([
      ["brand-a", "Brand A ERP", true],
      ["brand-b", "Brand B ERP", false],
    ]);
    expect(res.body.kind).toBe("company");
  });
});

describe("Given a SKU looked up with two ERPs", () => {
  test("Then the ERP that owns it is asked, at its own address, and named", async () => {
    erp.product.mockResolvedValue({
      data: { name: "Sign", sku: "SIGN1", type: "FERT" },
      ok: true,
      status: 200,
    });
    const res = await lookup.main({ sku: "SIGN1" });

    expect(erp.product).toHaveBeenCalledTimes(1);
    expect(erp.product.mock.calls[0][0].ERP_BASE_URL).toBe(B);
    expect(res.body.owner).toEqual({ id: "brand-b", name: "Brand B ERP" });
    expect(res.body.found).toEqual({ commerce: true, erp: true });
  });

  test("Then a SKU Commerce does not have asks every ERP, and the one still holding it owns it", async () => {
    // The ownership rule reads the product's attributes, and for a SKU Commerce lacks that
    // read throws; it must not be made (AB-54).
    goneFromCommerce("GONE1");
    erp.product.mockImplementation((params, sku) =>
      Promise.resolve(
        params.ERP_BASE_URL === A
          ? { data: { name: "Kept", sku, type: "FERT" }, ok: true, status: 200 }
          : { data: { errorCode: "NOT_FOUND" }, ok: false, status: 404 },
      ),
    );
    const res = await lookup.main({ sku: "GONE1" });

    expect(res.statusCode).toBe(200);
    expect(productAttributes).not.toHaveBeenCalled();
    expect(erp.product.mock.calls.map((c) => c[0].ERP_BASE_URL)).toEqual([
      A,
      B,
    ]);
    expect(res.body.found).toEqual({ commerce: false, erp: true });
    expect(res.body.owner).toEqual({ id: "brand-a", name: "Brand A ERP" });
    expect(res.body.owners).toEqual(["brand-a"]);
  });

  test("Then a SKU neither Commerce nor any ERP has answers with both sides empty, not an error", async () => {
    goneFromCommerce("GONE2");
    erp.product.mockResolvedValue({
      data: { errorCode: "NOT_FOUND" },
      ok: false,
      status: 404,
    });
    const res = await lookup.main({ sku: "GONE2" });

    expect(res.statusCode).toBe(200);
    expect(res.body.found).toEqual({ commerce: false, erp: false });
    expect(res.body.owner).toBeNull();
    expect(res.body.owners).toEqual([]);
  });

  test("Then a SKU no ERP owns is shown with an empty ERP side and no owner", async () => {
    const res = await lookup.main({ sku: "NOBODY" });
    expect(erp.product).not.toHaveBeenCalled();
    expect(res.body.owner).toBeNull();
    expect(res.body.found.erp).toBe(false);
  });
});
