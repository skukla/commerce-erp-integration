import { materialsFrom, mirror, partnersFrom } from "#lib/mirror";

const OFFLINE_503 = /503.*offline/u;

describe("Given the mirror", () => {
  test("Then products become materials with their stock", () => {
    const rows = materialsFrom(
      [
        { listPrice: 10, name: "A", sku: "A1" },
        { listPrice: 5, sku: "" },
      ],
      new Map([["A1", 7]]),
    );
    expect(rows).toEqual([{ listPrice: 10, name: "A", sku: "A1", stock: 7 }]);
  });
  test("Then companies become partners keyed C<id> with their group, credit and email domain", () => {
    const rows = partnersFrom([
      {
        creditLimit: 500,
        customerGroupId: 4,
        email: "buyer@acme.example",
        id: 7,
        name: "Acme",
      },
    ]);
    expect(rows).toEqual([
      {
        commerceCompanyId: "7",
        creditLimit: 500,
        customerGroupId: "4",
        emailDomain: "acme.example",
        id: "C7",
        name: "Acme",
      },
    ]);
  });
  test("Then a mirror reads all three and imports once", async () => {
    const readers = {
      listCompanies: vi.fn(async () => [{ id: 1, name: "One" }]),
      listProducts: vi.fn(async () => [{ listPrice: 1, name: "P", sku: "P1" }]),
      listStock: vi.fn(async () => new Map([["P1", 2]])),
    };
    const erp = {
      importRecords: vi.fn(async () => ({
        data: {
          materials: { created: 1, updated: 0 },
          partners: { created: 1, updated: 0 },
        },
        ok: true,
        status: 200,
      })),
    };
    const result = await mirror({}, readers, erp, "Demo");
    expect(erp.importRecords).toHaveBeenCalledWith(
      {},
      {
        materials: [{ listPrice: 1, name: "P", sku: "P1", stock: 2 }],
        partners: [
          {
            commerceCompanyId: "1",
            creditLimit: undefined,
            customerGroupId: undefined,
            emailDomain: undefined,
            id: "C1",
            name: "One",
          },
        ],
        projectName: "Demo",
      },
    );
    expect(result.counts).toEqual({ companies: 1, products: 1 });
  });
  test("Then an ERP refusal is an error, not a silent success", async () => {
    const readers = {
      listCompanies: async () => [],
      listProducts: async () => [],
      listStock: async () => new Map(),
    };
    const erp = {
      importRecords: async () => ({
        data: { errorMessage: "offline" },
        ok: false,
        status: 503,
      }),
    };
    await expect(mirror({}, readers, erp)).rejects.toThrow(OFFLINE_503);
  });
});
