import {
  clearHistory,
  readHistory,
  recordCommerceChange,
  recordOrderOutcome,
  recordReset,
  resetHistoryClient,
} from "#lib/history";

const TRAILING_STAR = /\*$/;
const STORE_KEY = /^[a-zA-Z0-9-_.]{1,1024}$/;

/** App Builder State, in memory: get, put and a glob `list`, as aio-lib-state 5 has them. */
function memoryState() {
  const store = new Map();
  return {
    delete: vi.fn((k) => {
      store.delete(k);
      return Promise.resolve();
    }),
    get: vi.fn((k) =>
      Promise.resolve(store.has(k) ? { value: store.get(k) } : undefined),
    ),
    // A plain generator: `for await` walks it the same as the library's async one.
    *list({ match }) {
      const prefix = match.replace(TRAILING_STAR, "");
      yield { keys: [...store.keys()].filter((k) => k.startsWith(prefix)) };
    },
    put: vi.fn((k, v, opts) => {
      // aio-lib-state refuses any key outside its alphabet (lib/constants.js,
      // REGEX_PATTERN_STORE_KEY); a fake that accepts every key hid a lost reset line.
      if (!STORE_KEY.test(k)) {
        return Promise.reject(new Error(`invalid key ${k}`));
      }
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

  // A shipment, invoice, hold or cancel made in Commerce Admin names the ERPs it went to (the
  // order's parts) and the order, so its Activity row carries ERP chips and opens the trace.
  test("Then a change made in Commerce keeps the ERPs it was told to and its order", async () => {
    await recordCommerceChange(
      "shipped",
      { entity_id: 7, increment_id: "3000000011", order_id: 55 },
      {
        erpIds: ["erp", "contoso"],
        message: "Commerce shipment 3000000011: told both ERPs.",
        orderRef: "3000000021",
        outcome: "sent",
      },
    );

    const [entry] = await readHistory();
    expect(entry).toMatchObject({
      erpIds: ["erp", "contoso"],
      kind: "shipped",
      orderRef: "3000000021",
      ref: "3000000011",
    });
  });

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

  test("Then a reset clears every record and leaves one line saying it happened (AB-16n)", async () => {
    await recordOrderOutcome(order("000000001"), {
      message: "sent",
      outcome: "sent",
    });
    await recordOrderOutcome(order("000000002"), {
      message: "held",
      outcome: "held",
    });

    expect(await clearHistory()).toBe(2);
    await recordReset("Demo reset on 2026-09-22: 1 order cancelled.");

    const history = await readHistory();
    expect(history).toEqual([
      {
        attempts: 1,
        direction: "reset",
        firstAt: "2026-09-22T10:00:00.000Z",
        kind: "reset",
        lastAt: "2026-09-22T10:00:00.000Z",
        message: "Demo reset on 2026-09-22: 1 order cancelled.",
        outcome: "done",
        ref: "2026-09-22",
      },
    ]);
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
