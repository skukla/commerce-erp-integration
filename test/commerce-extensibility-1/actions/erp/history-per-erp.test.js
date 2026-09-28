/*
 * The Admin page's history with several ERPs (AB-16c): each record names the ERPs it concerns,
 * and the page can ask for one ERP's records. An ERP event names its ERP (`erpId`, contract
 * version 4); an order's record speaks for all its parts, so its ERPs are the parts' ERPs
 * (lib/order-parts.js). Derived when read, so records written before this change are named too.
 */
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

import { resetErpsClient } from "#lib/erps";
import { readHistory } from "#lib/history";
import { resetOrderPartsClient, writeOrderParts } from "#lib/order-parts";
import { main } from "#src/erp/history/index";

import { fakeState } from "../../../box/state.js";
import { BOTH, OWN } from "../../../lib/per-erp-harness.js";

const SPLIT = {
  direction: "to-erp",
  kind: "order",
  lastAt: "2026-09-28T10:00:00Z",
  outcome: "held",
  ref: "3000000022",
};
const NORTHWIND_ONLY = { ...SPLIT, outcome: "sent", ref: "3000000021" };
const FROM_CONTOSO = {
  direction: "from-erp",
  event: { data: { erpId: "contoso", sku: "SIGN-A2" } },
  eventId: "ev-1",
  kind: "price",
  lastAt: "2026-09-28T09:00:00Z",
  outcome: "applied",
  ref: "SIGN-A2",
};
// A stock event's value is a list of lines, so it names no ERP (contract version 4).
const STOCK = {
  direction: "from-erp",
  event: { data: [{ sku: "CAB-RED" }] },
  eventId: "ev-2",
  kind: "stock",
  lastAt: "2026-09-28T08:00:00Z",
  outcome: "applied",
  ref: "",
};

beforeEach(async () => {
  resetOrderPartsClient(fakeState());
  resetErpsClient({ get: async () => ({ value: JSON.stringify(BOTH) }) });
  await writeOrderParts("3000000022", {
    parts: { contoso: { status: "held" }, erp: { status: "sent" } },
  });
  await writeOrderParts("3000000021", { parts: { erp: { status: "sent" } } });
  readHistory.mockResolvedValue([SPLIT, NORTHWIND_ONLY, FROM_CONTOSO, STOCK]);
});
afterEach(() => {
  resetErpsClient();
  vi.clearAllMocks();
});

const list = async (extra = {}) =>
  (await main({ ...OWN, __ow_method: "get", ...extra })).body.entries;

describe("Given two ERPs", () => {
  test("Then each record names the ERPs it concerns, in list order", async () => {
    expect((await list()).map((e) => [e.ref, e.erpIds])).toEqual([
      ["3000000022", ["erp", "contoso"]],
      ["3000000021", ["erp"]],
      ["SIGN-A2", ["contoso"]],
      ["", []],
    ]);
  });

  test("Then asked for one ERP, only its records come back", async () => {
    expect((await list({ erp: "contoso" })).map((e) => e.ref)).toEqual([
      "3000000022",
      "SIGN-A2",
    ]);
    expect((await list({ erp: "erp" })).map((e) => e.ref)).toEqual([
      "3000000022",
      "3000000021",
    ]);
  });

  // The one-ERP view is filtered before the page's 100 are cut, so an ERP's older records
  // are not lost behind the other ERP's newer ones.
  test("Then one ERP's records are chosen from the whole history, not the newest 100", async () => {
    await list({ erp: "contoso", failedOnly: "true" });
    expect(readHistory).toHaveBeenCalledWith({
      failedOnly: true,
      limit: Number.POSITIVE_INFINITY,
    });
  });
});

describe("Given one ERP", () => {
  test("Then the records come back as they always did, with no ERP named", async () => {
    resetErpsClient({
      get: async () => ({ value: JSON.stringify([BOTH[0]]) }),
    });
    const entries = await list({ erp: "contoso" });
    expect(entries).toEqual([SPLIT, NORTHWIND_ONLY, FROM_CONTOSO, STOCK]);
    expect(readHistory).toHaveBeenCalledWith({ failedOnly: false });
  });
});
