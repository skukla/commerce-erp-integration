/*
 * A product save Commerce raises for the integration's own write is not imported back into
 * the ERP (AB-62). The sender is the real one, so what the ERP is or is not told is asserted
 * on the ERP client's arguments.
 */
vi.mock("#lib/erp", () => ({ erp: { importRecords: vi.fn() } }));
vi.mock("#lib/commerce", () => ({
  productAttributes: vi.fn(async () => ({})),
  sourceCodesOf: vi.fn(async () => []),
  warehousesOfSku: vi.fn(async () => [
    { code: "east", name: "East Warehouse", quantity: 25 },
  ]),
  websiteCodesOf: vi.fn(async () => []),
}));

import { erp } from "#lib/erp";
import { noteProductWrite, resetOwnWritesClient } from "#lib/own-writes";
import * as action from "#src/product/commerce/updated/index";

import { fakeState } from "../../../../../box/state.js";

const saveOf = (name, price) => ({
  data: {
    value: {
      created_at: "2024-01-01 00:00:00",
      name,
      price,
      sku: "51BSCU-BLBK",
      updated_at: "2026-10-02 16:06:34",
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  resetOwnWritesClient(fakeState());
  erp.importRecords.mockResolvedValue({ data: {}, ok: true, status: 200 });
});
afterEach(() => resetOwnWritesClient());

describe("Given the integration wrote a product's name and price to Commerce", () => {
  beforeEach(() =>
    noteProductWrite("51BSCU-BLBK", { name: "Cabinet (test)", price: 499 }),
  );

  test("Then the save event that write raised is not imported into the ERP, however many times it arrives", async () => {
    const first = await action.main(saveOf("Cabinet (test)", "499.000000"));
    const second = await action.main(saveOf("Cabinet (test)", "499.000000"));
    expect(first).toEqual({
      body: { message: "Skipped: the save of this integration's own write" },
      statusCode: 200,
      type: "success",
    });
    expect(second.statusCode).toBe(200);
    expect(erp.importRecords).not.toHaveBeenCalled();
  });

  test("Then a save with another name is a change made in Commerce and is imported", async () => {
    const res = await action.main(saveOf("Cabinet (Admin)", "499.000000"));
    expect(res.statusCode).toBe(200);
    expect(erp.importRecords).toHaveBeenCalledTimes(1);
    expect(erp.importRecords.mock.calls[0][1]).toEqual({
      origin: { document: "product 51BSCU-BLBK", system: "Adobe Commerce" },
      products: [
        { listPrice: 499, name: "Cabinet (Admin)", sku: "51BSCU-BLBK" },
      ],
      stock: [
        {
          sku: "51BSCU-BLBK",
          warehouses: [{ code: "east", name: "East Warehouse", quantity: 25 }],
        },
      ],
    });
  });

  test("Then a save with another price is a change made in Commerce and is imported", async () => {
    await action.main(saveOf("Cabinet (test)", "450.000000"));
    expect(erp.importRecords.mock.calls[0][1].products).toEqual([
      { listPrice: 450, name: "Cabinet (test)", sku: "51BSCU-BLBK" },
    ]);
  });
});

describe("Given the integration wrote nothing", () => {
  test("Then a product save is imported", async () => {
    await action.main(saveOf("Cabinet (test)", "499.000000"));
    expect(erp.importRecords).toHaveBeenCalledTimes(1);
  });
});
