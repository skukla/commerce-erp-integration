/*
 * A company saved in Commerce reaches every ERP the integration serves (slice B3a): a company
 * buying from several brands is a customer in each brand's ERP, paired per ERP.
 */
vi.mock("#lib/commerce", () => ({
  listWebsites: vi.fn(async () => [{ code: "bodea", id: 3, name: "Bodea" }]),
  readCompanyRow: vi.fn(async () => ({
    blocked: false,
    creditLimit: 5000,
    id: 21,
    legalAddress: null,
    legalName: null,
    name: "Kukla Studios",
    resellerId: null,
    vatTaxId: null,
    websiteId: 3,
  })),
}));
vi.mock("#lib/settings", () => ({ websiteSettings: vi.fn(async () => ({})) }));
vi.mock("#lib/erp", () => ({
  erp: {
    importRecords: vi.fn(async () => ({ data: {}, ok: true, status: 200 })),
  },
}));

import { erp } from "#lib/erp";
import { replaceErps, resetErpsClient } from "#lib/erps";
import { erpCustomerOf, resetKeyMapClient } from "#lib/key-map";
import { main } from "#src/company/commerce/saved/index";

const memory = () => {
  const store = new Map();
  return {
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
};
const EVENT = {
  data: { value: { id: 21 } },
  ERP_BASE_URL: "https://one.example",
};

beforeEach(() => {
  resetKeyMapClient(memory());
  resetErpsClient(memory());
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("Given one ERP", () => {
  test("Then the company goes to it as before and is paired as the single ERP's customer", async () => {
    const res = await main(EVENT);
    expect(res.statusCode).toBe(200);
    expect(erp.importRecords).toHaveBeenCalledTimes(1);
    expect(erp.importRecords.mock.calls[0][0]).toBe(EVENT);
    expect(await erpCustomerOf("21")).toBe("C21");
  });
});

describe("Given two ERPs in the stored list", () => {
  test("Then the company goes to each ERP at its own address and is paired in each", async () => {
    await replaceErps([
      {
        adapter: "demo-erp",
        connection: { baseUrl: "https://a.example" },
        id: "erp",
        name: "A ERP",
      },
      {
        adapter: "demo-erp",
        connection: { baseUrl: "https://b.example" },
        id: "brand-b",
        name: "B ERP",
      },
    ]);
    const res = await main(EVENT);
    expect(res.statusCode).toBe(200);
    const bases = erp.importRecords.mock.calls.map(([p]) => p.ERP_BASE_URL);
    expect(bases).toEqual(["https://a.example", "https://b.example"]);
    expect(await erpCustomerOf("21", "erp")).toBe("C21");
    expect(await erpCustomerOf("21", "brand-b")).toBe("C21");
  });

  test("Then one ERP refusing fails the event, so it is delivered again", async () => {
    await replaceErps([
      {
        adapter: "demo-erp",
        connection: { baseUrl: "https://a.example" },
        id: "erp",
        name: "A ERP",
      },
      {
        adapter: "demo-erp",
        connection: { baseUrl: "https://b.example" },
        id: "brand-b",
        name: "B ERP",
      },
    ]);
    erp.importRecords
      .mockResolvedValueOnce({ data: {}, ok: true, status: 200 })
      .mockResolvedValueOnce({
        data: { errorMessage: "offline" },
        ok: false,
        status: 503,
      });
    const res = await main(EVENT);
    expect(res.statusCode ?? res.error?.statusCode).toBe(500);
  });
});
