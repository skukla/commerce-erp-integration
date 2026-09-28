/*
 * Following one order with several ERPs (AB-16h): the ERP side of the trace comes from each ERP
 * that holds a part of the order, asked at its own address and signed with its own credential,
 * about its own sales order. Before, the first ERP was asked for whatever number Commerce held,
 * and a split order (which holds none) showed no ERP at all.
 */
vi.mock("@adobe/aio-commerce-sdk/auth", async (original) =>
  (await import("../../../lib/per-erp-harness.js")).mintPerClient(original),
);
vi.mock("#lib/history", () => ({
  readHistory: vi.fn(async () => []),
  recordOrderOutcome: vi.fn(),
}));
vi.mock("#lib/order-sync", () => ({ retryOrderToErp: vi.fn() }));
vi.mock("#lib/erp-event-history", () => ({
  HANDLER_ACTIONS: {},
  readErpEvent: vi.fn(),
}));
vi.mock("#lib/order-deps", () => ({ orderSyncDeps: vi.fn(() => ({})) }));
vi.mock("#lib/commerce", () => ({ getOrderByIncrementId: vi.fn() }));

import { getOrderByIncrementId } from "#lib/commerce";
import { resetErpTokenCache } from "#lib/erp";
import { resetErpsClient } from "#lib/erps";
import { readHistory } from "#lib/history";
import { resetOrderPartsClient, writeOrderParts } from "#lib/order-parts";
import { main } from "#src/erp/history/index";

import { fakeState } from "../../../box/state.js";
import { BOTH, erpFetch, OWN } from "../../../lib/per-erp-harness.js";

const ORDER = "000000042";
const A = "https://a.example/api/v1/web/demo-erp/orders";
const B = "https://b.example/api/v1/web/demo-erp/orders";

let erp;
beforeEach(() => {
  resetErpTokenCache();
  resetOrderPartsClient(fakeState());
  resetErpsClient({ get: async () => ({ value: JSON.stringify(BOTH) }) });
  erp = erpFetch((url) => {
    if (url.includes("?reference=")) {
      return {
        body: {
          items: url.startsWith(B) ? [{ number: "0000002000" }] : [],
        },
      };
    }
    const number = url.slice(-10);
    return {
      body: {
        history: [{ at: "2026-09-28T10:00:00Z", status: "created" }],
        number,
        status: "created",
      },
    };
  });
  vi.stubGlobal("fetch", erp.fetch);
  getOrderByIncrementId.mockResolvedValue({
    created_at: "2026-09-28T09:00:00Z",
    increment_id: ORDER,
    status: "processing",
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetErpsClient();
  vi.clearAllMocks();
});

const asked = () => erp.calls.map(({ client, url }) => [client, url]);
const trace = async () =>
  (await main({ ...OWN, __ow_method: "get", trace: ORDER })).body.trace;

describe("Given an order two ERPs share", () => {
  test("Then each ERP is asked for its own sales order, with its own credential", async () => {
    await writeOrderParts(ORDER, {
      parts: {
        contoso: { erpNumber: "0000002000", status: "sent" },
        erp: { erpNumber: "0000001000", status: "sent" },
      },
    });
    const result = await trace();
    expect(asked()).toEqual([
      ["integration-client", `${A}/0000001000`],
      ["contoso-client", `${B}/0000002000`],
    ]);
    expect(
      result.steps.filter((s) => s.where === "erp").map((s) => s.what),
    ).toEqual([
      "Northwind ERP created sales order 0000001000",
      "Contoso ERP created sales order 0000002000",
    ]);
    expect(result.summary.erps).toEqual([
      {
        name: "Northwind ERP",
        number: "0000001000",
        part: "sent",
        status: "created",
      },
      {
        name: "Contoso ERP",
        number: "0000002000",
        part: "sent",
        status: "created",
      },
    ]);
    expect(result.summary.reachedErp).toBe(true);
  });

  test("Then with Commerce not answering, every ERP is asked by the order's reference", async () => {
    getOrderByIncrementId.mockRejectedValue(new Error("timeout"));
    const result = await trace();
    expect(asked()).toEqual([
      ["integration-client", `${A}?reference=${ORDER}`],
      ["contoso-client", `${B}?reference=${ORDER}`],
      ["contoso-client", `${B}/0000002000`],
    ]);
    expect(result.summary.erpNumber).toBe("0000002000");
  });

  // Bodea 2026-09-28, order 3000000022: Northwind took its part, Contoso's waited. The one
  // send step read "Waiting for Northwind ERP" while its detail named Contoso: the label took
  // the name of the ERPs holding a sales order (only Northwind), not the ERP that waited.
  test("Then the send is one step per part, each naming its own ERP and why it waits", async () => {
    const waits =
      "Contoso ERP blocks this company; its lines wait until it lifts the block.";
    await writeOrderParts(ORDER, {
      parts: {
        contoso: { message: waits, status: "held" },
        erp: {
          erpNumber: "0000001000",
          message: "Order sent to Northwind ERP as 0000001000.",
          status: "sent",
        },
      },
    });
    readHistory.mockResolvedValueOnce([
      {
        attempts: 1,
        direction: "to-erp",
        firstAt: "2026-09-28T09:00:05Z",
        kind: "order",
        lastAt: "2026-09-28T09:00:05Z",
        message: `Order sent to Northwind ERP as 0000001000. ${waits}`,
        outcome: "held",
        ref: ORDER,
      },
    ]);
    const sends = (await trace()).steps
      .filter((s) => s.where === "integration")
      .map((s) => ({ detail: s.detail, what: s.what }));
    expect(sends).toEqual([
      {
        detail: "Order sent to Northwind ERP as 0000001000.",
        what: "Sent to Northwind ERP",
      },
      { detail: waits, what: "Waiting for Contoso ERP" },
    ]);
    expect(
      (await trace()).summary.erps.map(({ name, part }) => [name, part]),
    ).toEqual([
      ["Northwind ERP", "sent"],
      ["Contoso ERP", "held"],
    ]);
  });
});
