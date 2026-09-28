/*
 * Detach with several ERPs (AB-16h): it undoes what the integration wrote for EVERY ERP it
 * serves, so each listed ERP's orders are read, at its own address and signed with its own
 * credential. Before, only the first ERP's orders were read, and the other ERPs' numbers and
 * holds stayed on Commerce's orders after the integration was removed.
 */
vi.mock("@adobe/aio-commerce-sdk/auth", async (original) =>
  (await import("./per-erp-harness.js")).mintPerClient(original),
);

import { detach } from "#lib/detach";
import { erp as erpClient, resetErpTokenCache } from "#lib/erp";

import { BOTH, erpFetch, NORTHWIND, OWN } from "./per-erp-harness.js";

const ORDERS = {
  "https://a.example": [
    { commerceOrderId: 11, creditStatus: "none" },
    { commerceOrderId: 30, creditStatus: "none" },
  ],
  "https://b.example": [
    { commerceOrderId: 21, creditStatus: "held" },
    { commerceOrderId: 30, creditStatus: "none" },
  ],
};

let erp;
let commerce;
beforeEach(() => {
  resetErpTokenCache();
  erp = erpFetch((url) => ({
    body: { items: ORDERS[new URL(url).origin] },
  }));
  vi.stubGlobal("fetch", erp.fetch);
  commerce = {
    clearExtOrderId: vi.fn(async () => undefined),
    unholdIfHeld: vi.fn(async () => true),
  };
});
afterEach(() => vi.unstubAllGlobals());

const deps = (erps) => ({
  commerce,
  erp: erpClient,
  erps,
  ledger: { revertLedger: vi.fn(async () => ({ reverted: 0 })) },
  tierPrices: {},
});

describe("Given two ERPs", () => {
  test("Then each ERP's orders are read with its own credential, and every order is cleared once", async () => {
    const result = await detach(OWN, deps(BOTH));
    expect(erp.calls.map(({ client, url }) => [client, url])).toEqual([
      ["integration-client", "https://a.example/api/v1/web/demo-erp/orders"],
      ["contoso-client", "https://b.example/api/v1/web/demo-erp/orders"],
    ]);
    expect(commerce.clearExtOrderId.mock.calls.map(([, id]) => id)).toEqual([
      11, 30, 21,
    ]);
    expect(commerce.unholdIfHeld.mock.calls.map(([, id]) => id)).toEqual([21]);
    expect(result.orders).toEqual({ cleared: 3, failed: [] });
    expect(result.holds).toEqual({ failed: [], released: 1 });
  });

  test("Then an ERP that cannot list its orders is named, and the others are still undone", async () => {
    erp = erpFetch((url) =>
      url.startsWith("https://a.")
        ? { status: 503 }
        : { body: { items: ORDERS["https://b.example"] } },
    );
    vi.stubGlobal("fetch", erp.fetch);
    const result = await detach(OWN, deps(BOTH));
    expect(result.orders.failed).toEqual([
      { error: "Northwind ERP orders answered 503", orderId: "*" },
    ]);
    expect(result.orders.cleared).toBe(2);
  });
});

describe("Given one ERP", () => {
  test("Then its orders are read with the integration's params, as before", async () => {
    await detach(OWN, deps([NORTHWIND]));
    expect(erp.calls.map(({ client, url }) => [client, url])).toEqual([
      ["integration-client", "https://a.example/api/v1/web/demo-erp/orders"],
    ]);
  });
});
