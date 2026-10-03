/*
 * A cancel, hold or release made in Commerce on an order several ERPs share (AB-16h): every ERP
 * holding an open part of the order is told, each at its own address and signed with its own
 * credential, about its own sales order. Before, the change went to no ERP (a split order has no
 * ext_order_id) or, through the raw params, to the first ERP only.
 */
vi.mock("@adobe/aio-commerce-sdk/auth", async (original) =>
  (await import("../lib/per-erp-harness.js")).mintPerClient(original),
);

import { resetErpTokenCache } from "#lib/erp";
import { resetOrderPartsClient, writeOrderParts } from "#lib/order-parts";
import { resetOwnWritesClient } from "#lib/own-writes";
import { orderChangeToParts } from "#router/part-changes";

import { fakeState } from "../box/state.js";
import { BOTH, erpFetch, NORTHWIND, OWN } from "../lib/per-erp-harness.js";

/* A change sent to the ERP is remembered in State so its echo is known (lib/own-writes.js). */
beforeEach(() => resetOwnWritesClient(fakeState()));
afterEach(() => resetOwnWritesClient());

const ORDER = "000000042";
const A = "https://a.example/api/v1/web/demo-erp/orders";
const B = "https://b.example/api/v1/web/demo-erp/orders";

/** Each ERP's sales order, as the ERP answers it. */
let held;
let erp;
const answer = (url, init) => {
  const [, number] = url.split("/orders/");
  if (init.method === "GET") {
    return {
      body: {
        creditReason: held[number] ? "Put on hold in the web shop" : null,
        creditStatus: held[number] ? "held" : "none",
        header: "open",
        number,
      },
    };
  }
};

beforeEach(async () => {
  resetErpTokenCache();
  resetOrderPartsClient(fakeState());
  held = {};
  erp = erpFetch(answer);
  vi.stubGlobal("fetch", erp.fetch);
  await writeOrderParts(ORDER, {
    conflicts: [],
    parts: {
      contoso: { erpNumber: "0000002000", itemIds: [2], status: "sent" },
      erp: { erpNumber: "0000001000", itemIds: [1], status: "sent" },
    },
    unrouted: [],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const writes = () =>
  erp.calls
    .filter((c) => c.method === "POST")
    .map(({ client, url }) => ({ client, url }));
const change = (state, extra = {}) =>
  orderChangeToParts(
    { ...OWN, id: "evt-1" },
    { _isNew: false, increment_id: ORDER, state, ...extra },
    { erps: BOTH },
  );

describe("Given an order two ERPs share", () => {
  test("Then a cancel in Commerce reaches each ERP's own sales order, with its own credential", async () => {
    const result = await change("canceled");
    expect(result.outcome).toBe("sent");
    // The Admin page's Activity names the ERPs told, and opens the order's trace.
    expect(result.erpIds).toStrictEqual(BOTH.map((entry) => entry.id));
    expect(result.orderRef).toBe(ORDER);
    expect(writes()).toEqual([
      {
        client: "integration-client",
        url: `${A}/0000001000/cancel`,
      },
      { client: "contoso-client", url: `${B}/0000002000/cancel` },
    ]);
    expect(erp.calls[1].body).toEqual({
      origin: {
        document: "order 000000042",
        eventId: "evt-1",
        system: "Adobe Commerce",
      },
      reason: "Canceled in the web shop",
    });
  });

  test("Then a hold in Commerce reaches each ERP, and each is asked about its own order first", async () => {
    await change("holded");
    expect(
      erp.calls.map(({ client, method, url }) => [method, client, url]),
    ).toEqual([
      ["GET", "integration-client", `${A}/0000001000`],
      ["POST", "integration-client", `${A}/0000001000/credit/hold`],
      ["GET", "contoso-client", `${B}/0000002000`],
      ["POST", "contoso-client", `${B}/0000002000/credit/hold`],
    ]);
  });

  test("Then taking it off hold releases only the holds Commerce made", async () => {
    held = { "0000002000": true };
    const result = await change("processing");
    expect(writes()).toEqual([
      { client: "contoso-client", url: `${B}/0000002000/credit/release` },
    ]);
    expect(result.outcome).toBe("sent");
  });

  test("Then a part its ERP cancelled, or one without a sales order, is not told", async () => {
    await writeOrderParts(ORDER, {
      parts: {
        contoso: { heldBy: "block", status: "held" },
        erp: { erpNumber: "0000001000", status: "cancelled" },
      },
    });
    expect(await change("canceled")).toBeNull();
    expect(erp.calls).toEqual([]);
  });

  test("Then one ERP that cannot answer holds the event for redelivery", async () => {
    erp = erpFetch((url, init) =>
      url.startsWith(B) ? { status: 503 } : answer(url, init),
    );
    vi.stubGlobal("fetch", erp.fetch);
    const result = await change("canceled");
    expect(result.outcome).toBe("held");
    expect(result.statusCode).toBe(503);
    expect(result.message).toContain("Contoso ERP");
  });
});

describe("Given one ERP", () => {
  test("Then nothing is decided here: the single-ERP change handles the order as before", async () => {
    const result = await orderChangeToParts(
      OWN,
      { increment_id: ORDER, state: "canceled" },
      { erps: [NORTHWIND] },
    );
    expect(result).toBeNull();
    expect(erp.calls).toEqual([]);
  });
});

describe("Given a new order", () => {
  test("Then it is the order send's, not a change", async () => {
    const result = await change("new", { _isNew: true });
    expect(result).toBeNull();
  });
});
