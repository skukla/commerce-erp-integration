/*
 * be-observer.company_contract_update (contract version 7, raised by contract.changed): one
 * customer's WHOLE set of prices in force, price groups already resolved in the ERP. The
 * handler applies it as a replace for the ERP the event names (lib/erps.js eventErpId), and
 * the ERP event history records how it ended.
 */
vi.mock("#lib/contract-prices", async (importOriginal) => ({
  ...(await importOriginal()),
  applyCustomerPrices: vi.fn(),
}));

import { applyCustomerPrices } from "#lib/contract-prices";
import { readErpEvent } from "#lib/erp-event-history";
import { replaceErps, resetErpsClient } from "#lib/erps";
import { resetHistoryClient } from "#lib/history";
import * as contractUpdated from "#src/company/external/contract-updated/index";

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

const LINE = {
  appliesTo: "priceGroup",
  contractNumber: "PL-7",
  kind: "price",
  minQty: 1,
  price: 40,
  sku: "accessmesh",
};
const event = (value, id = "ev-1") => ({
  data: value,
  id,
  type: "be-observer.company_contract_update",
});

beforeEach(() => {
  const state = memoryState();
  resetErpsClient(state);
  resetHistoryClient(state);
  applyCustomerPrices.mockResolvedValue({
    removed: 1,
    unchanged: 0,
    written: 1,
  });
});
afterEach(() => vi.clearAllMocks());

describe("Given one customer's prices in force from the ERP", () => {
  test("Then they are applied as that customer's whole set, for the single ERP, and the history records it", async () => {
    const res = await contractUpdated.main(
      event({ lines: [LINE], partnerId: "C21" }),
    );
    expect(res.statusCode).toBe(200);
    const [, customer, deps] = applyCustomerPrices.mock.calls[0];
    expect(customer).toEqual({
      erpId: "erp",
      lines: [LINE],
      partnerId: "C21",
    });
    expect(Object.keys(deps).sort()).toEqual([
      "commerceCompanyOf",
      "ledger",
      "ownsSku",
      "tierPrices",
    ]);
    const saved = await readErpEvent("ev-1");
    expect(saved).toMatchObject({
      kind: "contract",
      message: "partner C21: 1 price line(s) in force",
      outcome: "applied",
    });
  });

  test("Then with several ERPs it is the ERP the event names, and an event naming none cannot be placed", async () => {
    await replaceErps([
      {
        adapter: "demo-erp",
        connection: { baseUrl: "https://a.example" },
        id: "acme",
        name: "Acme ERP",
      },
      {
        adapter: "demo-erp",
        connection: { baseUrl: "https://g.example" },
        id: "globex",
        name: "Globex ERP",
      },
    ]);
    await contractUpdated.main(
      event({ erpId: "globex", lines: [], partnerId: "C21" }),
    );
    expect(applyCustomerPrices.mock.calls[0][1].erpId).toBe("globex");
    const refused = await contractUpdated.main(
      event({ lines: [], partnerId: "C21" }, "ev-2"),
    );
    expect(refused.error.statusCode).toBe(400);
    expect(applyCustomerPrices).toHaveBeenCalledTimes(1);
  });

  test("Then an event without a partner or a list of lines is refused, and a skip is applied with its reason", async () => {
    expect(
      (await contractUpdated.main(event({ lines: [LINE] }))).error.statusCode,
    ).toBe(400);
    expect(
      (await contractUpdated.main(event({ partnerId: "C21" }))).error
        .statusCode,
    ).toBe(400);
    applyCustomerPrices.mockResolvedValueOnce({
      removed: 0,
      skipped: "company 20 has no custom shared catalog",
      unchanged: 0,
      written: 0,
    });
    const skipped = await contractUpdated.main(
      event({ lines: [LINE], partnerId: "C19" }),
    );
    expect(skipped.statusCode).toBe(200);
    expect(skipped.body.message).toContain(
      "company 20 has no custom shared catalog",
    );
  });

  test("Then a Commerce failure is a 500, so I/O Events delivers it again", async () => {
    applyCustomerPrices.mockRejectedValueOnce(new Error("timeout"));
    const res = await contractUpdated.main(
      event({ lines: [LINE], partnerId: "C21" }),
    );
    expect(res.error.statusCode).toBe(500);
  });
});
