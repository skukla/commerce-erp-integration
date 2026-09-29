/*
 * The key map across several ERPs (slice B3a): a company buying from two brands is a customer
 * in each brand's ERP, so it pairs once PER ERP. An entry without an ERP id is the single ERP
 * "erp", which is how every map stored before several ERPs reads.
 */
import {
  commerceCompanyOf,
  companyOfErpEvent,
  erpCustomerOf,
  keyMapProblem,
  pairCustomer,
  readKeyMap,
  replaceKeyMap,
  resetKeyMapClient,
} from "#lib/key-map";

beforeEach(() => {
  const store = new Map();
  resetKeyMapClient({
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  });
});

const MAP = [
  { commerce: "21", erp: "C000103", kind: "customer" },
  { commerce: "21", erp: "K-77", erpId: "demo-erp-2", kind: "customer" },
];

describe("Given a company that buys from two ERPs", () => {
  test("Then each ERP finds its own customer, and the unnamed entry is the single ERP's", async () => {
    await replaceKeyMap(MAP);
    expect(await erpCustomerOf("21")).toBe("C000103");
    expect(await erpCustomerOf("21", "erp")).toBe("C000103");
    expect(await erpCustomerOf("21", "demo-erp-2")).toBe("K-77");
    expect(await erpCustomerOf("21", "demo-erp-3")).toBeNull();
    expect(await commerceCompanyOf("K-77", "demo-erp-2")).toBe("21");
    expect(await commerceCompanyOf("K-77")).toBeNull();
  });

  test("Then two ERPs may number customers alike without clashing", () => {
    expect(
      keyMapProblem([
        { commerce: "21", erp: "C1", kind: "customer" },
        { commerce: "22", erp: "C1", erpId: "demo-erp-2", kind: "customer" },
      ]),
    ).toBeNull();
    expect(
      keyMapProblem([
        { commerce: "21", erp: "C1", erpId: "demo-erp-2", kind: "customer" },
        { commerce: "21", erp: "C2", erpId: "demo-erp-2", kind: "customer" },
      ]),
    ).toContain("twice");
  });

  test("Then pairing in one ERP leaves the other ERP's pair alone", async () => {
    await replaceKeyMap(MAP);
    await pairCustomer("21", "K-78", "demo-erp-2");
    expect(await erpCustomerOf("21", "demo-erp-2")).toBe("K-78");
    expect(await erpCustomerOf("21")).toBe("C000103");
    expect(await readKeyMap()).toHaveLength(2);
  });

  test("Then an ERP's customer event finds the company through that ERP's pairs", async () => {
    await replaceKeyMap(MAP);
    expect(
      await companyOfErpEvent({ erpId: "demo-erp-2", partnerId: "K-77" }),
    ).toBe("21");
    expect(await companyOfErpEvent({ partnerId: "C000103" })).toBe("21");
    expect(
      await companyOfErpEvent({ erpId: "demo-erp-2", partnerId: "C000103" }),
    ).toBeNull();
  });

  test("Then an ERP id that is not a slug is refused", () => {
    expect(
      keyMapProblem([
        { commerce: "1", erp: "C1", erpId: "Contoso ERP", kind: "customer" },
      ]),
    ).toContain("erpId");
  });
});
