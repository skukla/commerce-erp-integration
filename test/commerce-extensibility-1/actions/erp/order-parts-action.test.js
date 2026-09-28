/*
 * erp/order-parts and erp/resend-part: the order view's "ERP parts" page reads an order's
 * parts by the Commerce order id the view button hands it, and Re-send sends one part again
 * (router/resend-part.js).
 */
vi.mock("#lib/order-parts", () => ({
  readOrderParts: vi.fn(async () => ({
    conflicts: [],
    parts: {
      "brand-a": { erpNumber: "A-1", skus: ["CAB1"], status: "sent" },
      "brand-b": { message: "offline", skus: ["SIGN1"], status: "failed" },
    },
    unrouted: [],
  })),
}));
vi.mock("#lib/history", () => ({
  readRecord: vi.fn(async () => undefined),
  recordOrderOutcome: vi.fn(async () => undefined),
}));
vi.mock("#lib/erps", () => ({
  loadErps: vi.fn(async () => [
    { id: "brand-a", name: "Brand A ERP" },
    { id: "brand-b", name: "Brand B ERP" },
  ]),
}));
vi.mock("#src/order/commerce-order-api-client", () => ({
  getOrder: vi.fn(async () => ({ entity_id: 55, increment_id: "000000042" })),
}));
vi.mock("#lib/order-deps", () => ({
  orderSyncDeps: vi.fn(() => ({ marker: "deps" })),
}));
vi.mock("#router/resend-part", () => ({
  resendPart: vi.fn(async () => ({
    message: "sent",
    outcome: "sent",
    part: { status: "sent" },
    statusCode: 200,
  })),
}));

import { readRecord } from "#lib/history";
import { readOrderParts } from "#lib/order-parts";
import { resendPart } from "#router/resend-part";
import * as orderParts from "#src/erp/order-parts/index";
import * as resend from "#src/erp/resend-part/index";
import { getOrder } from "#src/order/commerce-order-api-client";

afterEach(() => vi.clearAllMocks());

describe("Given the order view's parts page opening on an order", () => {
  test("Then the Commerce order id is read to its number, and its parts come back with the ERPs' names", async () => {
    const res = await orderParts.main({ orderId: "55" });

    expect(res.statusCode).toBe(200);
    expect(getOrder).toHaveBeenCalledWith({ orderId: "55" }, 55);
    expect(readOrderParts).toHaveBeenCalledWith("000000042");
    expect(readRecord).toHaveBeenCalledWith("order.000000042");
    expect(res.body).toMatchObject({
      incrementId: "000000042",
      orderId: 55,
      summary: "1 failed",
    });
    expect(res.body.rows.map((r) => [r.erpName, r.canResend])).toEqual([
      ["Brand A ERP", false],
      ["Brand B ERP", true],
    ]);
  });

  test("Then an order id that is not a number is refused, and nothing is read", async () => {
    const res = await orderParts.main({ orderId: "55; drop" });
    expect(res.error.statusCode).toBe(400);
    expect(getOrder).not.toHaveBeenCalled();
  });
});

describe("Given staff pressing Re-send on one part", () => {
  test("Then that part is sent again with the real collaborators, and the answer names how it ended", async () => {
    const res = await resend.main({
      __ow_method: "post",
      erpId: "brand-b",
      incrementId: "000000042",
    });

    expect(res.statusCode).toBe(200);
    expect(resendPart).toHaveBeenCalledWith(
      expect.objectContaining({ erpId: "brand-b" }),
      { erpId: "brand-b", incrementId: "000000042" },
      { marker: "deps" },
    );
    expect(res.body).toMatchObject({
      outcome: "sent",
      part: { status: "sent" },
    });
  });

  test("Then a refusal is answered with its status and words", async () => {
    resendPart.mockResolvedValueOnce({
      message: "Brand B ERP still blocks this company",
      outcome: "held",
      statusCode: 409,
    });
    const res = await resend.main({
      __ow_method: "post",
      erpId: "brand-b",
      incrementId: "000000042",
    });
    expect(res.error.statusCode).toBe(409);
    expect(res.error.body.message).toContain("still blocks");
  });

  test("Then a request that does not name the order and the ERP is refused", async () => {
    const bad = [
      { __ow_method: "post", erpId: "brand-b" },
      { __ow_method: "post", erpId: "Brand B!", incrementId: "000000042" },
      { __ow_method: "get", erpId: "brand-b", incrementId: "000000042" },
    ];
    for (const params of bad) {
      // biome-ignore lint/performance/noAwaitInLoops: one refusal at a time
      expect((await resend.main(params)).error.statusCode).toBe(400);
    }
    expect(resendPart).not.toHaveBeenCalled();
  });
});
