/*
 * Blocks per brand (design v1 §3.1, owner 2026-09-27): with several ERPs, an ERP's block
 * holds only that ERP's parts of the company's orders and never touches the Commerce
 * company's own active/blocked flag. The unblock releases them.
 */
import {
  companyOrders,
  isBlocked,
  noteCompanyOrder,
  resetErpBlocksClient,
} from "#lib/erp-blocks";
import {
  readOrderParts,
  resetOrderPartsClient,
  writeOrderParts,
} from "#lib/order-parts";
import { applyErpBlock } from "#router/erp-blocks";

function memoryState() {
  const store = new Map();
  return {
    delete: async (k) => store.delete(k),
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

const BLOCKED_BY_SIGN_ERP = /^Sign ERP blocks this company/u;

const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "cabinets",
    name: "Cabinet ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "signs",
    name: "Sign ERP",
  },
];

function deps() {
  return {
    addComment: vi.fn(async () => undefined),
    applyCombinedStatus: vi.fn(async () => ({
      action: "hold",
      reason: "r",
      status: "on-hold",
    })),
    erps: ERPS,
    getOrder: vi.fn(async (_p, incrementId) => ({
      entity_id: 55,
      increment_id: incrementId,
      items: [],
    })),
    reroute: vi.fn(async () => ({ outcome: "sent" })),
    setCompanyStatus: vi.fn(),
  };
}

beforeEach(async () => {
  const state = memoryState();
  resetErpBlocksClient(state);
  resetOrderPartsClient(state);
  await writeOrderParts("000000042", {
    companyId: "7",
    parts: {
      cabinets: { erpNumber: "A-1", status: "sent" },
      signs: { erpNumber: "B-1", status: "sent" },
    },
  });
  await noteCompanyOrder("7", "000000042", 55);
});

describe("Given two ERPs and a company with an open order split across them", () => {
  test("Then one ERP's block holds only its part, and the company flag is never touched", async () => {
    const d = deps();
    const result = await applyErpBlock(
      {},
      { blocked: true, companyId: "7", erpId: "signs" },
      d,
    );
    const record = await readOrderParts("000000042");
    expect(record.parts.signs).toMatchObject({
      heldBy: "block",
      prevStatus: "sent",
      status: "held",
    });
    expect(record.parts.cabinets.status).toBe("sent");
    expect(await isBlocked("7", "signs")).toBe(true);
    expect(await isBlocked("7", "cabinets")).toBe(false);
    expect(d.setCompanyStatus).not.toHaveBeenCalled();
    expect(d.applyCombinedStatus).toHaveBeenCalledWith(
      {},
      55,
      expect.objectContaining({ companyId: "7" }),
    );
    expect(d.addComment.mock.calls[0][2].statusHistory.comment).toMatch(
      BLOCKED_BY_SIGN_ERP,
    );
    expect(result).toEqual({ orders: 1 });
  });

  test("Then the unblock puts the part back as it was, and the company flag is still never touched", async () => {
    const d = deps();
    await applyErpBlock(
      {},
      { blocked: true, companyId: "7", erpId: "signs" },
      d,
    );
    await applyErpBlock(
      {},
      { blocked: false, companyId: "7", erpId: "signs" },
      d,
    );
    const record = await readOrderParts("000000042");
    expect(record.parts.signs).toEqual({ erpNumber: "B-1", status: "sent" });
    expect(await isBlocked("7", "signs")).toBe(false);
    expect(d.setCompanyStatus).not.toHaveBeenCalled();
    expect(d.reroute).not.toHaveBeenCalled();
  });

  test("Then a part held by the block before it was ever sent is sent when the block lifts", async () => {
    const d = deps();
    await writeOrderParts("000000043", {
      companyId: "7",
      parts: { signs: { heldBy: "block", message: "m", status: "held" } },
    });
    await noteCompanyOrder("7", "000000043", 56);
    await applyErpBlock(
      {},
      { blocked: false, companyId: "7", erpId: "signs" },
      d,
    );
    expect(d.getOrder).toHaveBeenCalledWith({}, "000000043");
    expect(d.reroute).toHaveBeenCalledTimes(1);
    expect(
      (await readOrderParts("000000043")).parts.signs.heldBy,
    ).toBeUndefined();
  });

  test("Then a part the ERP itself held for credit is not released by an unblock", async () => {
    const d = deps();
    await writeOrderParts("000000042", {
      companyId: "7",
      parts: { signs: { erpNumber: "B-1", status: "held" } },
    });
    await applyErpBlock(
      {},
      { blocked: false, companyId: "7", erpId: "signs" },
      d,
    );
    expect((await readOrderParts("000000042")).parts.signs.status).toBe("held");
  });

  test("Then a finished order is dropped from the company's open orders and left alone", async () => {
    const d = deps();
    d.applyCombinedStatus.mockResolvedValue({
      action: "none",
      status: "processing",
    });
    d.getOrderState = vi.fn(async () => "complete");
    await applyErpBlock(
      {},
      { blocked: true, companyId: "7", erpId: "signs" },
      d,
    );
    expect((await readOrderParts("000000042")).parts.signs.status).toBe("sent");
    expect(await companyOrders("7")).toEqual([]);
  });
});
