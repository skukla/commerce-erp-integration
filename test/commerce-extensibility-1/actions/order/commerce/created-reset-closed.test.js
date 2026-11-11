/*
 * An order a demo reset closed is never sent (AB-16n). The reset clears the order's ERP number
 * and deletes its parts record, then takes it off hold and cancels it; each of those saves raises
 * the order event this action receives, and without the mark the order would read as never sent
 * and go to the ERPs as new. An order Demo Builder's Clear closed carries no mark, only its reset
 * note in Commerce's history (owner, 2026-11-11), which is read when the event carries none.
 */
vi.mock("#router/route-order", () => ({
  routeOrder: vi.fn(async () => ({
    message: "routed",
    outcome: "sent",
    statusCode: 200,
  })),
}));
vi.mock("#lib/history", () => ({ recordOrderOutcome: vi.fn() }));
vi.mock("#lib/commerce", async (original) => ({
  ...(await original()),
  getOrderByIncrementId: vi.fn(async (_p, incrementId) => ({
    increment_id: incrementId,
    status_histories:
      incrementId === "000000057"
        ? [{ comment: "Canceled by the demo reset on 2026-11-11." }]
        : [],
  })),
}));

import { getOrderByIncrementId } from "#lib/commerce";
import { markClosedByReset, resetOrderPartsClient } from "#lib/order-parts";
import { routeOrder } from "#router/route-order";
import { main } from "#src/order/commerce/created/index";

import { fakeState } from "../../../../box/state.js";

const event = (incrementId) => ({
  data: {
    value: { _isNew: false, increment_id: incrementId, state: "canceled" },
  },
});

beforeEach(() => resetOrderPartsClient(fakeState()));
afterEach(() => {
  resetOrderPartsClient();
  vi.clearAllMocks();
});

describe("Given an order save event for an order the reset closed", () => {
  test("Then nothing is routed, and the answer says why and ends the delivery", async () => {
    await markClosedByReset("000000042", "2026-09-28");
    const res = await main(event("000000042"));
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe(
      "order 000000042 was closed by the demo reset on 2026-09-28; it is not sent to any ERP.",
    );
    expect(routeOrder).not.toHaveBeenCalled();
  });

  test("Then any other order is routed as before", async () => {
    await markClosedByReset("000000042", "2026-09-28");
    const res = await main(event("000000043"));
    expect(res.statusCode).toBe(200);
    expect(routeOrder).toHaveBeenCalledTimes(1);
  });
});

describe("Given an order save event for an order Demo Builder's Clear closed (its note, no mark)", () => {
  test("Then the order is read for its history, nothing is routed, and the answer names the note's day", async () => {
    const res = await main(event("000000057"));
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe(
      "order 000000057 was closed by the demo reset on 2026-11-11; it is not sent to any ERP.",
    );
    expect(getOrderByIncrementId).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "000000057",
    );
    expect(routeOrder).not.toHaveBeenCalled();
  });

  test("Then an order that cannot be read is routed as before", async () => {
    getOrderByIncrementId.mockRejectedValueOnce(new Error("503"));
    const res = await main(event("000000057"));
    expect(res.statusCode).toBe(200);
    expect(routeOrder).toHaveBeenCalledTimes(1);
  });
});
