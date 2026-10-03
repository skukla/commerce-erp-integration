/*
 * A product deleted in Commerce, with several ERPs: no ERP is called (AB-26y step 5); the
 * history record names the ERP that owned the product, by the router's ownership rule
 * (router/ownership.js). The product is already gone from Commerce, so its owner is read from
 * the event, which carries `erp_owner`. An event that does not carry it names no ERP.
 */
import { fakeState } from "../../../../../box/state.js";

const state = fakeState();
vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: async () => state },
}));
vi.mock("#lib/erps", async (original) => ({
  ...(await original()),
  loadErps: vi.fn(),
}));

import { loadErps } from "#lib/erps";
import { readHistory, resetHistoryClient } from "#lib/history";
import * as deleted from "#src/product/commerce/deleted/index";

const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "brand-a",
    name: "Brand A ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "brand-b",
    name: "Brand B ERP",
  },
];

const fetchSpy = vi.fn();

beforeEach(() => {
  state.reset();
  resetHistoryClient(state);
  loadErps.mockResolvedValue(ERPS);
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Given a product deleted in Commerce and two ERPs", () => {
  test("Then the record names the ERP its erp_owner names, and neither ERP is called", async () => {
    const res = await deleted.main({
      data: { value: { erp_owner: "brand-b", id: 9, sku: "SIGN1" } },
      id: "evt-1",
    });

    expect(res.statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const [record] = await readHistory();
    expect(record).toMatchObject({
      erpIds: ["brand-b"],
      kind: "product-deleted",
      message:
        "Product SIGN1 was deleted in Commerce. Brand B ERP keeps it until its next reset",
      ref: "SIGN1",
    });
  });

  test("Then a product whose owner is no listed ERP is recorded with no ERP named", async () => {
    await deleted.main({
      data: { value: { erp_owner: "brand-z", sku: "X1" } },
    });
    const [record] = await readHistory();
    expect(record.ref).toBe("X1");
    expect(record.erpIds).toBeUndefined();
    expect(record.message).toBe("Product X1 was deleted in Commerce");
  });

  test("Then an event that does not name the owner is recorded with no ERP named: the event cannot say", async () => {
    const res = await deleted.main({ data: { value: { sku: "CAB1" } } });
    expect(res.statusCode).toBe(200);
    const [record] = await readHistory();
    expect(record.erpIds).toBeUndefined();
    expect(record.message).toBe(
      "Product CAB1 was deleted in Commerce. An ERP that holds it keeps it until its next reset",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
