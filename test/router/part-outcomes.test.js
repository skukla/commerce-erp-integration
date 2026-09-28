/*
 * Inbound ERP messages matched to their part, Phase B slice B2. Every ERP order message
 * names the Commerce order (incrementId) and the ERP's own sales order (erpNumber); with
 * several ERPs the part is the one holding that ERP number, or the one of the ERP the message
 * names (erpId). With one ERP there is no parts record and nothing is recorded: the handlers
 * act on the whole order exactly as before.
 */
import {
  orderPartsKey,
  readOrderParts,
  resetOrderPartsClient,
} from "#lib/order-parts";
import {
  findPart,
  handlePartMessage,
  recordPartMessage,
} from "#router/part-outcomes";

const ERPS = [
  { adapter: "demo-erp", connection: {}, id: "brand-a", name: "Brand A ERP" },
  { adapter: "demo-erp", connection: {}, id: "brand-b", name: "Brand B ERP" },
];
const RECORD = {
  conflicts: [],
  parts: {
    "brand-a": { erpNumber: "0000001001", skus: ["CAB1"], status: "sent" },
    "brand-b": { erpNumber: "0000001001", skus: ["SIGN1"], status: "sent" },
  },
  unrouted: [],
};

function memoryState(record) {
  const store = new Map(
    record ? [[orderPartsKey("000000042"), JSON.stringify(record)]] : [],
  );
  return {
    get: vi.fn(async (k) =>
      store.has(k) ? { value: store.get(k) } : undefined,
    ),
    put: vi.fn(async (k, v) => store.set(k, v)),
  };
}

describe("Given a part to find", () => {
  test("Then the ERP the message names wins, else the ERP number", () => {
    expect(
      findPart(RECORD, { erpId: "brand-b", erpNumber: "0000001001" }),
    ).toBe("brand-b");
    const one = {
      parts: { "brand-a": { erpNumber: "7" }, "brand-b": { erpNumber: "8" } },
    };
    expect(findPart(one, { erpNumber: "8" })).toBe("brand-b");
    expect(findPart(one, { erpNumber: "9" })).toBeNull();
  });

  test("Then an ERP number two parts share, with no ERP named, matches neither", () => {
    expect(findPart(RECORD, { erpNumber: "0000001001" })).toBeNull();
  });
});

describe("Given an ERP message about an order", () => {
  test("Then with one ERP nothing is read or recorded", async () => {
    const state = memoryState(RECORD);
    resetOrderPartsClient(state);
    const result = await recordPartMessage(
      {},
      "hold",
      { erpNumber: "7", held: true, incrementId: "000000042" },
      [ERPS[0]],
    );
    expect(result).toBeNull();
    expect(state.get).not.toHaveBeenCalled();
  });

  test("Then with several ERPs the named part takes the adapter's outcome", async () => {
    resetOrderPartsClient(memoryState(RECORD));
    const result = await recordPartMessage(
      {},
      "hold",
      {
        erpId: "brand-b",
        erpNumber: "0000001001",
        held: true,
        incrementId: "000000042",
        reason: "Credit limit exceeded",
      },
      ERPS,
    );
    expect(result).toMatchObject({ erp: { id: "brand-b" }, matched: true });
    const saved = await readOrderParts("000000042");
    expect(saved.parts["brand-b"].status).toBe("held");
    expect(saved.parts["brand-a"].status).toBe("sent");
  });

  test.each([
    ["cancel", {}, "cancelled"],
    ["invoice", {}, "invoiced"],
    ["shipment", {}, "shipped"],
    ["order-status", { status: "confirmed" }, "confirmed"],
    ["hold", { held: false }, "sent"],
  ])("Then a %s message records %s", async (kind, extra, expected) => {
    resetOrderPartsClient(memoryState(RECORD));
    await recordPartMessage(
      {},
      kind,
      {
        erpId: "brand-a",
        erpNumber: "0000001001",
        incrementId: "000000042",
        ...extra,
      },
      ERPS,
    );
    expect((await readOrderParts("000000042")).parts["brand-a"].status).toBe(
      expected,
    );
  });

  test("Then a message for an order the router never split, or a part it cannot find, is reported, not recorded", async () => {
    const state = memoryState();
    resetOrderPartsClient(state);
    expect(
      await recordPartMessage(
        {},
        "hold",
        { erpNumber: "1", held: true, incrementId: "000000042" },
        ERPS,
      ),
    ).toEqual({ matched: false, reason: "order 000000042 was not routed" });
    resetOrderPartsClient(memoryState(RECORD));
    expect(
      await recordPartMessage(
        {},
        "hold",
        { erpNumber: "0000001001", held: true, incrementId: "000000042" },
        ERPS,
      ),
    ).toMatchObject({ matched: false });
  });
});

describe("Given the handlers hand an ERP message to the router", () => {
  test("Then one ERP answers null and nothing is written", async () => {
    const addComment = vi.fn();
    expect(
      await handlePartMessage({}, "hold", { held: true }, 55, {
        addComment,
        erps: [ERPS[0]],
      }),
    ).toBeNull();
    expect(addComment).not.toHaveBeenCalled();
  });

  test("Then a held part is noted under its ERP's name and the order is put On Hold", async () => {
    resetOrderPartsClient(memoryState(RECORD));
    const addComment = vi.fn(async () => ({}));
    const applyCombinedStatus = vi.fn(async () => ({
      action: "hold",
      reason: "waiting on brand-b (held)",
      status: "on-hold",
    }));
    const result = await handlePartMessage(
      {},
      "hold",
      {
        erpId: "brand-b",
        erpNumber: "0000001001",
        held: true,
        incrementId: "000000042",
        reason: "Credit limit exceeded",
      },
      55,
      { addComment, applyCombinedStatus, erps: ERPS },
    );
    expect(applyCombinedStatus).toHaveBeenCalledWith(
      {},
      55,
      expect.objectContaining({
        parts: expect.objectContaining({
          "brand-b": expect.objectContaining({ status: "held" }),
        }),
      }),
    );
    expect(result.message).toBe(
      "Brand B ERP: ERP sales order 0000001001 on credit hold in the ERP: Credit limit exceeded. Order put On Hold: waiting on brand-b (held).",
    );
    expect(addComment).toHaveBeenCalledWith({}, 55, {
      statusHistory: {
        comment: result.message,
        is_customer_notified: 0,
        is_visible_on_front: 0,
      },
    });
  });
});
