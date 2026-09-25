import {
  readHistory,
  recordOrderOutcome,
  resetHistoryClient,
} from "#lib/history";

const TRAILING_STAR = /\*$/;

/** App Builder State, in memory: get, put and a glob `list`, as aio-lib-state 5 has them. */
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
    put: vi.fn((k, v, opts) => {
      store.set(k, v);
      return Promise.resolve(opts);
    }),
    store,
  };
}

const order = (incrementId) => ({ increment_id: incrementId });

describe("Given the integration's history", () => {
  let state;
  beforeEach(() => {
    state = memoryState();
    resetHistoryClient(state);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  test("Then an order's outcome is kept under its own key, for 14 days", async () => {
    await recordOrderOutcome(order("000000042"), {
      message: "order 000000042 is ERP sales order 5000017.",
      outcome: "sent",
    });

    const [entry] = await readHistory();
    expect(entry).toEqual({
      attempts: 1,
      direction: "to-erp",
      firstAt: "2026-09-22T10:00:00.000Z",
      kind: "order",
      lastAt: "2026-09-22T10:00:00.000Z",
      message: "order 000000042 is ERP sales order 5000017.",
      outcome: "sent",
      ref: "000000042",
    });
    expect(state.put.mock.calls[0][0]).toBe("history.order.000000042");
    expect(state.put.mock.calls[0][2]).toEqual({ ttl: 1_209_600 });
  });

  // A held order is delivered again by I/O Events up to ~100 times in a day: one record,
  // counting the tries, not a line per try.
  test("Then later outcomes for the same order update its one record", async () => {
    await recordOrderOutcome(order("42"), {
      message: "waiting",
      outcome: "held",
    });
    vi.setSystemTime(new Date("2026-09-22T10:08:00Z"));
    await recordOrderOutcome(order("42"), { message: "sent", outcome: "sent" });

    const entries = await readHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      attempts: 2,
      firstAt: "2026-09-22T10:00:00.000Z",
      lastAt: "2026-09-22T10:08:00.000Z",
      outcome: "sent",
    });
  });

  // D8: the steps of one send are not extra tries, and the ERP's number survives a failure.
  test("Then mid-send steps do not count as tries, and the ERP's number is kept", async () => {
    await recordOrderOutcome(
      order("42"),
      { message: "being sent", outcome: "sending" },
      { progress: true },
    );
    await recordOrderOutcome(
      order("42"),
      { erpNumber: "0000001002", message: "writing back", outcome: "sending" },
      { progress: true },
    );
    await recordOrderOutcome(order("42"), {
      message: "write-back failed",
      outcome: "failed",
    });

    expect((await readHistory())[0]).toMatchObject({
      attempts: 1,
      erpNumber: "0000001002",
      outcome: "failed",
    });
  });

  test("Then a skipped order is not recorded — it fires on every later save", async () => {
    await recordOrderOutcome(order("42"), {
      message: "not new",
      outcome: "skipped",
    });

    expect(await readHistory()).toStrictEqual([]);
  });

  test("Then who retried is kept when a person retried it", async () => {
    await recordOrderOutcome(
      order("42"),
      { message: "sent", outcome: "sent" },
      { retriedBy: "admin" },
    );

    expect((await readHistory())[0]).toMatchObject({ retriedBy: "admin" });
  });

  test("Then the newest comes first, and failed-only keeps held and refused ones", async () => {
    await recordOrderOutcome(order("1"), { message: "", outcome: "sent" });
    vi.setSystemTime(new Date("2026-09-22T10:01:00Z"));
    await recordOrderOutcome(order("2"), { message: "", outcome: "held" });
    vi.setSystemTime(new Date("2026-09-22T10:02:00Z"));
    await recordOrderOutcome(order("3"), { message: "", outcome: "dropped" });

    expect((await readHistory()).map((e) => e.ref)).toEqual(["3", "2", "1"]);
    expect((await readHistory({ failedOnly: true })).map((e) => e.ref)).toEqual(
      ["3", "2"],
    );
    expect((await readHistory({ limit: 1 })).map((e) => e.ref)).toEqual(["3"]);
    expect((await readHistory({ ref: "2" })).map((e) => e.ref)).toEqual(["2"]);
  });

  test("Then a storage failure never breaks the sync that recorded it", async () => {
    state.put.mockRejectedValueOnce(new Error("state unavailable"));
    const logger = { warn: vi.fn() };

    await expect(
      recordOrderOutcome(
        order("42"),
        { message: "", outcome: "sent" },
        { logger },
      ),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("state unavailable"),
    );
  });
});
