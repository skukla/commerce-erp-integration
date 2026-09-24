/*
 * The ERP → Commerce half of the history: each ERP event the integration applied, refused,
 * or could not apply yet, under the event's own id, in words a merchant reads.
 */
import {
  badRequest,
  buildErrorResponse,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";

import { recordingErpEvent } from "#lib/erp-event-history";
import { readHistory, resetHistoryClient } from "#lib/history";

const TRAILING_STAR = /\*$/;

function memoryState() {
  const store = new Map();
  return {
    get: vi.fn((k) =>
      Promise.resolve(store.has(k) ? { value: store.get(k) } : undefined),
    ),
    // A plain generator: `for await` walks it the same as the library's async one.
    *list({ match }) {
      const prefix = match.replace(TRAILING_STAR, "");
      yield { keys: [...store.keys()].filter((k) => k.startsWith(prefix)) };
    },
    put: vi.fn((k, v) => {
      store.set(k, v);
      return Promise.resolve();
    }),
  };
}

const event = (type, data, id = "ev-1") => ({ data, id, type });

describe("Given an ERP event applied to Commerce", () => {
  let state;
  beforeEach(() => {
    state = memoryState();
    resetHistoryClient(state);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  test("Then the handler's answer is passed on unchanged, and the change is recorded in words", async () => {
    const answer = ok("Product updated successfully");
    const handler = recordingErpEvent("price", async () => answer);
    const params = event("be-observer.catalog_product_update", {
      price: 42,
      sku: "ABC",
    });

    await expect(handler(params)).resolves.toBe(answer);

    const [entry] = await readHistory();
    expect(entry).toStrictEqual({
      attempts: 1,
      direction: "from-erp",
      event: {
        data: { price: 42, sku: "ABC" },
        type: "be-observer.catalog_product_update",
      },
      eventId: "ev-1",
      firstAt: "2026-09-22T10:00:00.000Z",
      kind: "price",
      lastAt: "2026-09-22T10:00:00.000Z",
      message: "SKU ABC: price 42",
      outcome: "applied",
      ref: "ABC",
    });
    expect(state.put.mock.calls[0][0]).toBe("history.erp.ev-1");
  });

  test.each([
    [
      "stock",
      { outOfStock: false, quantity: 7, sku: "ABC", source: "east" },
      "SKU ABC at east: 7 in stock",
      "ABC",
    ],
    [
      "order-status",
      { incrementId: "42", status: "processing" },
      "order 42: processing",
      "42",
    ],
    ["shipment", { incrementId: "42" }, "order 42: shipped", "42"],
    ["invoice", { incrementId: "42" }, "order 42: invoiced", "42"],
    ["cancel", { incrementId: "42" }, "order 42: cancelled", "42"],
    [
      "hold",
      { held: true, incrementId: "42" },
      "order 42: on credit hold",
      "42",
    ],
    [
      "hold",
      { held: false, incrementId: "42" },
      "order 42: credit hold released",
      "42",
    ],
    [
      "credit",
      { companyId: 7, creditLimit: 5000 },
      "company 7: credit limit 5000",
      "7",
    ],
    ["block", { blocked: true, companyId: 7 }, "company 7: blocked", "7"],
  ])(
    "Then a %s event reads as what changed",
    async (kind, data, message, ref) => {
      await recordingErpEvent(kind, async () => ok("done"))(event("t", data));

      expect((await readHistory())[0]).toMatchObject({ kind, message, ref });
    },
  );

  // I/O Events delivers a 5xx again; the same event keeps its one record and counts the tries.
  test("Then an event that could not be applied yet is failed, and its redelivery updates the same record", async () => {
    const params = event("t", { companyId: 7, creditLimit: 5000 });
    await recordingErpEvent("credit", async () =>
      buildErrorResponse(503, { body: { message: "Commerce answered 503" } }),
    )(params);
    vi.setSystemTime(new Date("2026-09-22T10:01:00Z"));
    await recordingErpEvent("credit", async () => ok("done"))(params);

    const entries = await readHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ attempts: 2, outcome: "applied" });
  });

  test("Then a failure says what was not applied and why", async () => {
    await recordingErpEvent("credit", async () =>
      buildErrorResponse(503, { body: { message: "Commerce answered 503" } }),
    )(event("t", { companyId: 7, creditLimit: 5000 }));

    expect((await readHistory())[0]).toMatchObject({
      message:
        "company 7: credit limit 5000 — not applied: Commerce answered 503",
      outcome: "failed",
    });
  });

  test("Then an event Commerce refused is refused, and failed-only keeps it", async () => {
    await recordingErpEvent("price", async () => badRequest("no such SKU"))(
      event("t", { price: 1, sku: "ZZZ" }),
    );

    expect((await readHistory({ failedOnly: true }))[0]).toMatchObject({
      message: "SKU ZZZ: price 1 — not applied: no such SKU",
      outcome: "refused",
    });
  });

  test("Then a handler that throws is recorded as failed, and the throw is passed on", async () => {
    const handler = recordingErpEvent("price", () =>
      Promise.reject(new Error("boom")),
    );

    await expect(handler(event("t", { price: 1, sku: "A" }))).rejects.toThrow(
      "boom",
    );
    expect((await readHistory())[0]).toMatchObject({ outcome: "failed" });
  });

  test("Then a person's retry is marked as theirs", async () => {
    await recordingErpEvent("price", async () => ok("done"))({
      ...event("t", { price: 1, sku: "A" }),
      __retriedBy: "admin",
    });

    expect((await readHistory())[0]).toMatchObject({ retriedBy: "admin" });
  });
});
