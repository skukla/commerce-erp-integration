/*
 * Re-send one part (Phase B slice B7): staff press Re-send on a held or failed part on the
 * order's parts page. Only that part is sent again, through its ERP's adapter, with only its
 * lines; a part already with its ERP is never sent twice; then the combined status is written
 * again from the whole record.
 */
import { resetErpBlocksClient, setBlock } from "#lib/erp-blocks";
import {
  readOrderParts,
  resetOrderPartsClient,
  writeOrderParts,
} from "#lib/order-parts";
import { resendPart } from "#router/resend-part";

const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "brand-a",
    name: "Brand A ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "brand-b",
    name: "Brand B ERP",
  },
];

const ORDER = {
  base_currency_code: "USD",
  base_grand_total: 200,
  entity_id: 55,
  increment_id: "000000042",
  items: [
    { base_price: 100, item_id: 1, qty_ordered: 1, sku: "CAB1" },
    { base_price: 50, item_id: 2, qty_ordered: 2, sku: "SIGN1" },
  ],
  store_id: 3,
};

const RECORD = {
  conflicts: [],
  parts: {
    "brand-a": {
      erpNumber: "A-1",
      itemIds: [1],
      skus: ["CAB1"],
      status: "sent",
    },
    "brand-b": {
      itemIds: [2],
      message: "Brand B ERP did not answer",
      skus: ["SIGN1"],
      status: "failed",
    },
  },
  unrouted: [],
};

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

function deps(erps = ERPS) {
  return {
    addNote: vi.fn(async () => ({})),
    applyCombinedStatus: vi.fn(async () => ({
      action: "none",
      reason: "every part is with its ERP",
      status: "processing",
    })),
    erp: {
      createOrder: vi.fn(async () => ({
        data: { number: "B-7" },
        ok: true,
        status: 201,
      })),
    },
    findOrder: vi.fn(async () => ({
      entityId: 55,
      extOrderId: null,
      storeId: 3,
    })),
    getOrder: vi.fn(async () => ORDER),
    loadErps: vi.fn(async () => erps),
    logger: { warn: vi.fn() },
    setExtOrderId: vi.fn(async () => ({})),
    settingsFor: vi.fn(async () => ({
      orders_hold_offline: true,
      orders_send: true,
    })),
  };
}

const sentTo = (d) =>
  d.erp.createOrder.mock.calls.map(([params, body]) => ({
    erp: params.ERP_BASE_URL,
    skus: body.lines.map((l) => l.sku),
  }));

beforeEach(async () => {
  resetOrderPartsClient(memoryState());
  resetErpBlocksClient(memoryState());
  await writeOrderParts("000000042", structuredClone(RECORD));
});

describe("Given a failed part and staff pressing Re-send", () => {
  test("Then only that part is sent, with only its lines, and the record and combined status follow", async () => {
    const d = deps();
    const result = await resendPart(
      {},
      { erpId: "brand-b", incrementId: "000000042" },
      d,
    );

    expect(result).toMatchObject({ outcome: "sent", statusCode: 200 });
    expect(sentTo(d)).toEqual([{ erp: "https://b.example", skus: ["SIGN1"] }]);
    const saved = await readOrderParts("000000042");
    expect(saved.parts["brand-b"]).toMatchObject({
      erpNumber: "B-7",
      status: "sent",
    });
    expect(saved.parts["brand-a"]).toStrictEqual(RECORD.parts["brand-a"]);
    expect(d.applyCombinedStatus).toHaveBeenCalledExactlyOnceWith(
      {},
      55,
      saved,
    );
  });

  test("Then pressing it again sends nothing: the part is already with its ERP", async () => {
    const d = deps();
    const ask = { erpId: "brand-b", incrementId: "000000042" };
    await resendPart({}, ask, d);
    const again = await resendPart({}, ask, d);

    expect(again).toMatchObject({ outcome: "skipped", statusCode: 200 });
    expect(d.erp.createOrder).toHaveBeenCalledTimes(1);
  });

  test("Then an ERP that still does not answer leaves the part failed, and says so", async () => {
    const d = deps();
    d.erp.createOrder.mockResolvedValueOnce({
      data: { errorMessage: "offline" },
      ok: false,
      status: 503,
    });
    const result = await resendPart(
      {},
      { erpId: "brand-b", incrementId: "000000042" },
      d,
    );
    expect(result.outcome).not.toBe("sent");
    const saved = await readOrderParts("000000042");
    expect(["held", "failed"]).toContain(saved.parts["brand-b"].status);
    expect(d.applyCombinedStatus).toHaveBeenCalled();
  });
});

describe("Given a part Re-send must refuse", () => {
  test("Then a part already sent is not sent again", async () => {
    const d = deps();
    const result = await resendPart(
      {},
      { erpId: "brand-a", incrementId: "000000042" },
      d,
    );
    expect(result).toMatchObject({ outcome: "skipped", statusCode: 200 });
    expect(d.erp.createOrder).not.toHaveBeenCalled();
  });

  test("Then a part still being sent is refused, so two presses never send twice", async () => {
    const record = structuredClone(RECORD);
    record.parts["brand-b"].status = "sending";
    await writeOrderParts("000000042", record);
    const d = deps();
    const result = await resendPart(
      {},
      { erpId: "brand-b", incrementId: "000000042" },
      d,
    );
    expect(result.statusCode).toBe(409);
    expect(d.erp.createOrder).not.toHaveBeenCalled();
  });

  test("Then an order with no such part, or an ERP not in the list, is not found", async () => {
    const d = deps();
    const noPart = await resendPart(
      {},
      { erpId: "brand-b", incrementId: "000000099" },
      d,
    );
    const noErp = await resendPart(
      {},
      { erpId: "brand-z", incrementId: "000000042" },
      d,
    );
    expect([noPart.statusCode, noErp.statusCode]).toEqual([404, 404]);
    expect(d.erp.createOrder).not.toHaveBeenCalled();
  });

  test("Then a part held by an ERP's block waits while the block stands", async () => {
    const record = structuredClone(RECORD);
    record.companyId = "7";
    record.parts["brand-b"] = {
      ...record.parts["brand-b"],
      heldBy: "block",
      status: "held",
    };
    await writeOrderParts("000000042", record);
    await setBlock("7", "brand-b", true);
    const d = deps();
    const result = await resendPart(
      {},
      { erpId: "brand-b", incrementId: "000000042" },
      d,
    );
    expect(result).toMatchObject({ outcome: "held", statusCode: 409 });
    expect(result.message).toContain("Brand B ERP still blocks");
    expect(d.erp.createOrder).not.toHaveBeenCalled();
  });
});

describe("Given one ERP", () => {
  test("Then the whole order is its one part, sent again as it came", async () => {
    const single = [{ ...ERPS[0], id: "erp" }];
    await writeOrderParts("000000042", {
      conflicts: [],
      parts: {
        erp: { itemIds: [1, 2], skus: ["CAB1", "SIGN1"], status: "failed" },
      },
      unrouted: [],
    });
    const d = deps(single);
    const result = await resendPart(
      {},
      { erpId: "erp", incrementId: "000000042" },
      d,
    );
    expect(result.outcome).toBe("sent");
    expect(sentTo(d)[0].skus).toEqual(["CAB1", "SIGN1"]);
  });
});
