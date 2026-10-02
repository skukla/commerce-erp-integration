/*
 * The return records (returns-design.md §4): one per Commerce return, holding each ERP's piece;
 * and, per order, the ERP credit memos already made into Commerce credit memos, so a
 * redelivered credit memo event credits nothing twice.
 */
import {
  orderCreditsKey,
  orderReturnKey,
  readOrderCredits,
  readOrderReturn,
  resetOrderReturnsClient,
  writeOrderCredits,
  writeOrderReturn,
} from "#lib/order-returns";

function memoryState() {
  const store = new Map();
  return {
    get: vi.fn(async (k) =>
      store.has(k) ? { value: store.get(k) } : undefined,
    ),
    put: vi.fn(async (k, v) => store.set(k, v)),
    store,
  };
}

let state;
beforeEach(() => {
  state = memoryState();
  resetOrderReturnsClient(state);
});

describe("Given a return's record", () => {
  test("Then an unknown return reads as empty, and a written one reads back under order-returns-<id>", async () => {
    expect(await readOrderReturn(4)).toEqual({ pieces: {}, unrouted: [] });

    await writeOrderReturn(4, {
      orderIncrementId: "5000000002",
      pieces: { erp: { status: "sent" } },
      unrouted: [],
    });

    expect(orderReturnKey(4)).toBe("order-returns-4");
    expect(state.store.has("order-returns-4")).toBe(true);
    expect((await readOrderReturn(4)).pieces.erp.status).toBe("sent");
    // Kept a year, like the order's parts.
    expect(state.put.mock.calls[0][2]).toEqual({ ttl: 365 * 24 * 60 * 60 });
  });
});

describe("Given an order's applied credit memos", () => {
  test("Then none reads as empty, and a written set reads back under order-credits-<number>", async () => {
    expect(await readOrderCredits("5000000002")).toEqual({ applied: {} });

    await writeOrderCredits("5000000002", {
      applied: { "erp/9500000001": { commerceCreditMemoId: "1" } },
    });

    expect(orderCreditsKey("5000000002")).toBe("order-credits-5000000002");
    expect(
      (await readOrderCredits("5000000002")).applied["erp/9500000001"],
    ).toEqual({ commerceCreditMemoId: "1" });
  });

  test("Then a key keeps only State's alphabet", () => {
    expect(orderCreditsKey("A/1 2")).toBe("order-credits-A_1_2");
  });
});
