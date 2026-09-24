import {
  changedSkus,
  flatten,
  refreshStock,
  STOCK_REFRESH_ORIGIN,
} from "#lib/stock-refresh";

const stock = (rows) => new Map(Object.entries(rows));
const sources = new Map([
  ["default", "Default Source"],
  ["east", "East DC"],
]);

function fakeSnapshot(initial) {
  let held = initial;
  return {
    held: () => held,
    readSnapshot: vi.fn(() => Promise.resolve(held)),
    writeSnapshot: vi.fn((next) => {
      held = next;
      return Promise.resolve();
    }),
  };
}

const ERP_REFUSAL = /ERP stock import answered 400: quantity/u;

describe("Given the minute stock refresh", () => {
  test("Then the first read only seeds the snapshot: the mirror already gave the ERP this stock", async () => {
    const snapshot = fakeSnapshot(null);
    const erp = { importRecords: vi.fn() };
    const result = await refreshStock(
      {},
      {
        listStock: async () =>
          stock({ A1: [{ code: "default", quantity: 5 }] }),
      },
      erp,
      snapshot,
    );
    expect(result).toEqual({ changed: [], seeded: true, sent: 0 });
    expect(erp.importRecords).not.toHaveBeenCalled();
    expect(snapshot.held()).toEqual({ "A1|default": 5 });
  });
  test("Then a quantity that moved in any source sends that SKU's whole warehouse list, named from the store's sources", async () => {
    const snapshot = fakeSnapshot({
      "A1|default": 5,
      "A1|east": 3,
      "B2|default": 1,
    });
    const erp = {
      importRecords: vi.fn(async () => ({ data: {}, ok: true, status: 200 })),
    };
    const result = await refreshStock(
      { p: 1 },
      {
        listSources: async () => sources,
        listStock: async () =>
          stock({
            A1: [
              { code: "default", quantity: 5 },
              { code: "east", quantity: 12 },
            ],
            B2: [{ code: "default", quantity: 1 }],
          }),
      },
      erp,
      snapshot,
    );
    expect(result).toEqual({ changed: ["A1"], seeded: false, sent: 1 });
    expect(erp.importRecords).toHaveBeenCalledWith(
      { p: 1 },
      {
        origin: { event: STOCK_REFRESH_ORIGIN },
        stock: [
          {
            sku: "A1",
            warehouses: [
              { code: "default", name: "Default Source", quantity: 5 },
              { code: "east", name: "East DC", quantity: 12 },
            ],
          },
        ],
      },
    );
    expect(snapshot.held()).toEqual({
      "A1|default": 5,
      "A1|east": 12,
      "B2|default": 1,
    });
  });
  test("Then nothing moved means nothing sent and nothing rewritten", async () => {
    const snapshot = fakeSnapshot({ "A1|default": 5 });
    const erp = { importRecords: vi.fn() };
    const result = await refreshStock(
      {},
      {
        listStock: async () =>
          stock({ A1: [{ code: "default", quantity: 5 }] }),
      },
      erp,
      snapshot,
    );
    expect(result).toEqual({ changed: [], seeded: false, sent: 0 });
    expect(erp.importRecords).not.toHaveBeenCalled();
    expect(snapshot.writeSnapshot).not.toHaveBeenCalled();
  });
  test("Then a SKU that lost every source is a change the ERP is not sent (its product may be gone too), and the snapshot forgets it", async () => {
    const snapshot = fakeSnapshot({ "A1|default": 5, "B2|default": 2 });
    const erp = {
      importRecords: vi.fn(async () => ({ data: {}, ok: true, status: 200 })),
    };
    const result = await refreshStock(
      {},
      {
        listStock: async () =>
          stock({ A1: [{ code: "default", quantity: 5 }] }),
      },
      erp,
      snapshot,
    );
    expect(result).toEqual({ changed: ["B2"], seeded: false, sent: 0 });
    expect(erp.importRecords).not.toHaveBeenCalled();
    expect(snapshot.held()).toEqual({ "A1|default": 5 });
  });
  test("Then an ERP refusal is an error and the snapshot is not advanced, so the change is sent again next minute", async () => {
    const snapshot = fakeSnapshot({ "A1|default": 5 });
    const erp = {
      importRecords: vi.fn(async () => ({
        data: {
          errorMessage:
            "quantity for warehouse default must be a whole number of 0 or more",
        },
        ok: false,
        status: 400,
      })),
    };
    await expect(
      refreshStock(
        {},
        {
          listStock: async () =>
            stock({ A1: [{ code: "default", quantity: 6 }] }),
        },
        erp,
        snapshot,
      ),
    ).rejects.toThrow(ERP_REFUSAL);
    expect(snapshot.held()).toEqual({ "A1|default": 5 });
  });
  test("Then the helpers read a store's stock flat and name what moved", () => {
    const flat = flatten(
      stock({
        A1: [
          { code: "default", quantity: 1 },
          { code: "east", quantity: 2 },
        ],
      }),
    );
    expect(flat).toEqual({ "A1|default": 1, "A1|east": 2 });
    expect(
      changedSkus(
        { "A1|default": 1, "B2|x": 9 },
        { "A1|default": 1, "B2|x": 8, "C3|y": 0 },
      ),
    ).toEqual(["B2", "C3"]);
  });
});
