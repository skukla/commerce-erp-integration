/*
 * The order-changed action on an order several ERPs share (AB-16h): a cancel in Commerce reaches
 * every ERP holding an open part, at its own address and with its own credential
 * (router/part-changes.js), instead of none.
 */
vi.mock("@adobe/aio-commerce-sdk/auth", async (original) =>
  (await import("../../../../lib/per-erp-harness.js")).mintPerClient(original),
);
vi.mock("#lib/history", () => ({
  recordCommerceChange: vi.fn(async () => undefined),
}));

import { resetErpTokenCache } from "#lib/erp";
import { resetErpsClient } from "#lib/erps";
import { resetOrderPartsClient, writeOrderParts } from "#lib/order-parts";
import { main } from "#src/order/commerce/changed/index";

import { fakeState } from "../../../../box/state.js";
import { BOTH, erpFetch, OWN } from "../../../../lib/per-erp-harness.js";

let erp;
beforeEach(async () => {
  resetErpTokenCache();
  resetOrderPartsClient(fakeState());
  resetErpsClient({ get: async () => ({ value: JSON.stringify(BOTH) }) });
  erp = erpFetch((url) => ({
    body: { creditStatus: "none", header: "open", number: url.slice(-10) },
  }));
  vi.stubGlobal("fetch", erp.fetch);
  await writeOrderParts("000000042", {
    parts: {
      contoso: { erpNumber: "0000002000", status: "sent" },
      erp: { erpNumber: "0000001000", status: "sent" },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetErpsClient();
});

test("Given a split order cancelled in Commerce, Then each ERP cancels its own sales order", async () => {
  const res = await main({
    ...OWN,
    data: { value: { increment_id: "000000042", state: "canceled" } },
  });
  expect(res.statusCode).toBe(200);
  expect(
    erp.calls
      .filter((c) => c.method === "POST")
      .map(({ client, url }) => [client, url]),
  ).toEqual([
    [
      "integration-client",
      "https://a.example/api/v1/web/demo-erp/orders/0000001000/cancel",
    ],
    [
      "contoso-client",
      "https://b.example/api/v1/web/demo-erp/orders/0000002000/cancel",
    ],
  ]);
});
