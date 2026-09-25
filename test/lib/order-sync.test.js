/*
 * A Commerce order into the ERP from the order save event. The collaborators are handed
 * in, so these tests assert what is asked of each and what the event delivery is told.
 */
import {
  erpOrderFrom,
  isNewOrder,
  retryOrderToErp,
  sendOrderToErp,
} from "#lib/order-sync";

const ON = { orders_hold_offline: true, orders_send: true };
const NEW_ORDER = {
  base_currency_code: "USD",
  base_grand_total: 40,
  created_at: "2026-09-17 05:32:03",
  customer_email: "b@acme.example",
  customer_group_id: 4,
  increment_id: "3000000004",
  items: [
    { base_price: 20, item_id: 1, qty_ordered: 2, sku: "A" },
    { item_id: 2, parent_item_id: 1, sku: "child" },
  ],
  store_id: 3,
  updated_at: "2026-09-17 05:32:03",
};

function deps(overrides = {}) {
  return {
    addNote: vi.fn(async () => ({})),
    erp: {
      createOrder: vi.fn(async () => ({
        data: { number: "0000001002" },
        ok: true,
        status: 201,
      })),
    },
    findOrder: vi.fn(async () => ({
      entityId: 41,
      extOrderId: null,
      storeId: 3,
    })),
    logger: { warn: vi.fn() },
    setExtOrderId: vi.fn(async () => ({})),
    settingsFor: vi.fn(async () => ON),
    ...overrides,
  };
}

describe("Given the order save event", () => {
  test("Then a new order is created in the ERP with its entity id, and the number is written back", async () => {
    const d = deps();
    const result = await sendOrderToErp({ p: 1 }, NEW_ORDER, d);
    expect(result).toStrictEqual({
      erpNumber: "0000001002",
      message: "order 3000000004 is ERP sales order 0000001002.",
      outcome: "sent",
      statusCode: 200,
    });
    expect(d.settingsFor).toHaveBeenCalledWith(3, d.logger);
    expect(d.findOrder).toHaveBeenCalledWith({ p: 1 }, "3000000004");
    expect(d.erp.createOrder).toHaveBeenCalledWith(
      { p: 1 },
      {
        commerceCompanyId: null,
        commerceIncrementId: "3000000004",
        commerceOrderId: "41",
        currency: "USD",
        customerGroupId: "4",
        customerId: null,
        email: "b@acme.example",
        lines: [{ commerceItemId: 1, price: 20, qty: 2, sku: "A" }],
        origin: { event: "observer.sales_order_save_commit_after" },
        salesOrg: "1000",
        total: 40,
      },
      20_000,
    );
    // Written back with this pair's prefix (rule M4): no setting and no ERP name here, so ERP.
    expect(d.setExtOrderId).toHaveBeenCalledExactlyOnceWith(
      { p: 1 },
      41,
      "ERP-0000001002",
    );
    expect(d.addNote).toHaveBeenCalledWith(
      { p: 1 },
      41,
      "Created in the ERP as sales order 0000001002",
    );
  });

  test("Then the buyer's company goes with the order, and a company that cannot be read is null, not a guess", async () => {
    const withCompany = deps({ companyIdOf: vi.fn(async () => "21") });
    await sendOrderToErp(
      { p: 1 },
      { ...NEW_ORDER, customer_id: 44 },
      withCompany,
    );
    expect(withCompany.companyIdOf).toHaveBeenCalledWith({ p: 1 }, 44);
    expect(withCompany.erp.createOrder.mock.calls[0][1]).toMatchObject({
      commerceCompanyId: "21",
      customerId: 44,
    });

    const failing = deps({
      companyIdOf: vi.fn(async () => {
        throw new Error("Request timed out");
      }),
    });
    const result = await sendOrderToErp(
      {},
      { ...NEW_ORDER, customer_id: 44 },
      failing,
    );
    expect(result.outcome).toBe("sent");
    expect(
      failing.erp.createOrder.mock.calls[0][1].commerceCompanyId,
    ).toBeNull();
    expect(failing.logger.warn).toHaveBeenCalledWith(
      "order 3000000004: company of customer 44 not read: Request timed out",
    );

    const guest = deps({ companyIdOf: vi.fn() });
    await sendOrderToErp({}, NEW_ORDER, guest);
    expect(guest.companyIdOf).not.toHaveBeenCalled();
  });

  test("Then the write-back's own save event, carrying no order number, is skipped, and one with nothing is dropped naming its fields", async () => {
    const d = deps();
    expect(
      await sendOrderToErp({}, { entity_id: 6, ext_order_id: "ACME-1" }, d),
    ).toStrictEqual({
      message: "the save that wrote the ERP number back.",
      outcome: "skipped",
      statusCode: 200,
    });
    expect(await sendOrderToErp({}, { entity_id: 6 }, d)).toMatchObject({
      message: "The event carries no order number (fields: entity_id).",
      outcome: "dropped",
    });
    expect(d.findOrder).not.toHaveBeenCalled();
  });

  test("Then the save that writes the number back is skipped, whatever its flags say", async () => {
    const d = deps();
    const again = { ...NEW_ORDER, ext_order_id: "0000001002" };
    const result = await sendOrderToErp({}, again, d);
    expect(result.outcome).toBe("skipped");
    expect(d.erp.createOrder).not.toHaveBeenCalled();
  });

  test("Then a later save WITHOUT an ERP number is sent again, whatever Commerce's new-flag says", async () => {
    // An order placed through the REST cart arrives with `_isNew: false` (measured
    // 2026-09-25); the ERP's create is idempotent, so a resend is the safe answer.
    const d = deps();
    const later = {
      ...NEW_ORDER,
      _isNew: false,
      updated_at: "2026-09-17 06:00:00",
    };
    const result = await sendOrderToErp({}, later, d);
    expect(result.outcome).toBe("sent");
    expect(d.erp.createOrder).toHaveBeenCalled();
  });

  test("Then Commerce's new-order flag wins over the timestamps", () => {
    expect(isNewOrder({ ...NEW_ORDER, _isNew: false })).toBe(false);
    expect(isNewOrder({ _isNew: true, created_at: "a", updated_at: "b" })).toBe(
      true,
    );
    expect(isNewOrder({})).toBe(false);
  });

  test("Then a repeated delivery for an order that already has a number sends nothing", async () => {
    const d = deps({
      findOrder: vi.fn(async () => ({
        entityId: 41,
        extOrderId: "0000001002",
        storeId: 3,
      })),
    });
    expect((await sendOrderToErp({}, NEW_ORDER, d)).outcome).toBe("skipped");
    expect(d.erp.createOrder).not.toHaveBeenCalled();
  });

  test("Then a website with sending off sends nothing", async () => {
    const d = deps({
      settingsFor: vi.fn(async () => ({ ...ON, orders_send: false })),
    });
    const result = await sendOrderToErp({}, NEW_ORDER, d);
    expect(result.outcome).toBe("skipped");
    expect(result.message).toContain("sending orders to the ERP is off");
    expect(d.findOrder).not.toHaveBeenCalled();
  });

  test.each([
    [
      "an offline ERP",
      {
        data: { errorMessage: "Acme ERP is offline." },
        ok: false,
        status: 503,
      },
    ],
    ["a failing ERP", { data: {}, ok: false, status: 500 }],
    ["a busy ERP", { data: {}, ok: false, status: 429 }],
  ])(
    "Then %s with holding on asks for another delivery",
    async (_label, answer) => {
      const d = deps({ erp: { createOrder: vi.fn(async () => answer) } });
      const result = await sendOrderToErp({}, NEW_ORDER, d);
      expect(result.outcome).toBe("held");
      expect(result.statusCode).toBe(503);
      expect(d.setExtOrderId).not.toHaveBeenCalled();
    },
  );

  test("Then an unreachable ERP with holding on asks for another delivery, with the reason", async () => {
    const d = deps({
      erp: {
        createOrder: vi.fn(() =>
          Promise.reject(new Error("ERP request timed out")),
        ),
      },
    });
    const result = await sendOrderToErp({}, NEW_ORDER, d);
    expect(result).toStrictEqual({
      message:
        "order 3000000004 is waiting for the ERP (ERP request timed out).",
      outcome: "held",
      statusCode: 503,
    });
  });

  test("Then an offline ERP with holding off ends the delivery", async () => {
    const d = deps({
      erp: {
        createOrder: vi.fn(async () => ({ data: {}, ok: false, status: 503 })),
      },
      settingsFor: vi.fn(async () => ({ ...ON, orders_hold_offline: false })),
    });
    const result = await sendOrderToErp({}, NEW_ORDER, d);
    expect(result.outcome).toBe("dropped");
    expect(result.statusCode).toBe(400);
    expect(result.message).toContain("holding orders is off");
  });

  test("Then an order the ERP refuses ends the delivery whatever the setting", async () => {
    const d = deps({
      erp: {
        createOrder: vi.fn(async () => ({
          data: { errorMessage: "commerceOrderId is required" },
          ok: false,
          status: 400,
        })),
      },
    });
    const result = await sendOrderToErp({}, NEW_ORDER, d);
    expect(result).toStrictEqual({
      message:
        "order 3000000004 was refused by the ERP: commerceOrderId is required",
      outcome: "dropped",
      statusCode: 400,
    });
  });

  test("Then an order Commerce cannot find yet is delivered again later", async () => {
    const d = deps({ findOrder: vi.fn(async () => null) });
    const result = await sendOrderToErp({}, NEW_ORDER, d);
    expect(result.outcome).toBe("held");
    expect(d.erp.createOrder).not.toHaveBeenCalled();
  });

  test("Then an event without an order number ends the delivery", async () => {
    expect((await sendOrderToErp({}, {}, deps())).outcome).toBe("dropped");
    expect((await sendOrderToErp({}, undefined, deps())).outcome).toBe(
      "dropped",
    );
  });

  test("Then a note that cannot be added does not undo a sent order", async () => {
    const d = deps({
      addNote: vi.fn(() => Promise.reject(new Error("403"))),
    });
    const result = await sendOrderToErp({}, NEW_ORDER, d);
    expect(result.outcome).toBe("sent");
    expect(d.logger.warn).toHaveBeenCalledWith(
      "order 3000000004: note not added: 403",
    );
  });
});

describe("Given an order's lines", () => {
  test("Then child lines and lines without a SKU are left out, and a keyed list is read", () => {
    const request = erpOrderFrom(
      {
        increment_id: 7,
        items: { a: { qty_ordered: 1, sku: "A" }, b: { sku: "" } },
      },
      9,
    );
    expect(request.lines).toStrictEqual([
      { commerceItemId: null, price: 0, qty: 1, sku: "A" },
    ]);
    expect(request.commerceOrderId).toBe("9");
    expect(request.total).toBe(0);
    expect(request.currency).toBe("USD");
  });
});

// The Commerce Admin screen's Retry: one order a person sends again. The order is read
// from Commerce (the event that carried it is long gone) and goes through the same send.
describe("Given a retry of one order from the Admin screen", () => {
  const LATER = { ...NEW_ORDER, updated_at: "2026-09-17 06:10:00" };

  test("Then an order that is no longer new is still sent, as the first time", async () => {
    const d = deps({ getOrder: vi.fn(async () => LATER) });
    const result = await retryOrderToErp({ p: 1 }, "3000000004", d);
    expect(result.outcome).toBe("sent");
    expect(d.getOrder).toHaveBeenCalledWith({ p: 1 }, "3000000004");
    expect(d.erp.createOrder).toHaveBeenCalledWith(
      { p: 1 },
      expect.objectContaining({ commerceIncrementId: "3000000004" }),
      expect.any(Number),
    );
  });

  test("Then an order Commerce does not have is refused, and nothing is sent", async () => {
    const d = deps({ getOrder: vi.fn(async () => null) });
    const result = await retryOrderToErp({}, "999", d);
    expect(result).toStrictEqual({
      message: "Commerce has no order 999.",
      outcome: "dropped",
      statusCode: 404,
    });
    expect(d.erp.createOrder).not.toHaveBeenCalled();
  });

  test("Then an order that already has an ERP number is left alone", async () => {
    const d = deps({
      getOrder: vi.fn(async () => ({ ...LATER, ext_order_id: "0000001002" })),
    });
    expect((await retryOrderToErp({}, "3000000004", d)).outcome).toBe(
      "skipped",
    );
    expect(d.erp.createOrder).not.toHaveBeenCalled();
  });

  test("Then the website's settings still apply", async () => {
    const d = deps({
      getOrder: vi.fn(async () => LATER),
      settingsFor: vi.fn(async () => ({ ...ON, orders_send: false })),
    });
    const result = await retryOrderToErp({}, "3000000004", d);
    expect(result.outcome).toBe("skipped");
    expect(result.message).toContain("sending orders to the ERP is off");
  });
});

const NO_LINE =
  /no line of order .* belongs to this ERP \(products whose erp_owner is ACME\)/u;

describe("Given the business structure on an order", () => {
  test("Then the website's sales organisation rides on the request, and the written-back number carries the pair's prefix", async () => {
    const d = deps();
    d.settingsFor = vi.fn(async () => ({
      orders_hold_offline: true,
      orders_send: true,
      structure_order_prefix: "NW",
      structure_sales_org: "2000",
      structure_sales_org_name: "Online EU",
    }));
    await sendOrderToErp({ ERP_DISPLAY_NAME: "Northwind ERP" }, NEW_ORDER, d);
    const [, request] = d.erp.createOrder.mock.calls[0];
    expect(request.salesOrg).toBe("2000");
    expect(request.salesOrgName).toBe("Online EU");
    expect(d.setExtOrderId).toHaveBeenCalledWith(
      expect.anything(),
      41,
      "NW-0000001002",
    );
    expect(d.addNote).toHaveBeenCalledWith(
      expect.anything(),
      41,
      "Created in Northwind ERP as sales order 0000001002",
    );
  });
});

describe("Given two ERPs on one store: which orders are this ERP's (rule M3)", () => {
  test("Then an order with no line this ERP owns is skipped, in words; one with an owned line is sent", async () => {
    const d = deps();
    d.settingsFor = vi.fn(async () => ({
      orders_hold_offline: true,
      orders_send: true,
      structure_owns: "attribute",
      structure_owns_attribute: "erp_owner=ACME",
    }));
    d.ownsSku = vi.fn(async (_p, sku) => sku === "OURS");
    const none = await sendOrderToErp(
      {},
      { ...NEW_ORDER, items: [{ item_id: 1, qty_ordered: 1, sku: "THEIRS" }] },
      d,
    );
    expect(none.outcome).toBe("skipped");
    expect(none.message).toMatch(NO_LINE);
    expect(d.erp.createOrder).not.toHaveBeenCalled();
    const some = await sendOrderToErp(
      {},
      {
        ...NEW_ORDER,
        items: [
          { item_id: 1, qty_ordered: 1, sku: "THEIRS" },
          { item_id: 2, qty_ordered: 1, sku: "OURS" },
        ],
      },
      d,
    );
    expect(some.outcome).toBe("sent");
  });
});

// D8 (2026-09-25): a run that died after the ERP took the order left no record, so the Admin
// screen said "never sent" about an order the ERP had.
describe("Given an order on its way to the ERP", () => {
  test("Then the handover is recorded and noted on the order BEFORE the ERP is called", async () => {
    const calls = [];
    const d = deps({
      addNote: vi.fn(async (_p, _id, note) => calls.push(`note: ${note}`)),
      recordProgress: vi.fn(async (_order, step) =>
        calls.push(
          `record: ${step.outcome}${step.erpNumber ? ` ${step.erpNumber}` : ""}`,
        ),
      ),
    });
    d.erp.createOrder.mockImplementation(() => {
      calls.push("erp: create");
      return Promise.resolve({
        data: { number: "0000001002" },
        ok: true,
        status: 201,
      });
    });
    await sendOrderToErp({}, NEW_ORDER, d);
    expect(calls).toStrictEqual([
      "record: sending",
      "note: Sent to the ERP, waiting for confirmation",
      "erp: create",
      "record: sending 0000001002",
      "note: Created in the ERP as sales order 0000001002",
    ]);
  });

  test("Then a write-back that fails is a failure naming the ERP's number, delivered again", async () => {
    const d = deps({
      recordProgress: vi.fn(() => Promise.resolve()),
      setExtOrderId: vi.fn(async () => {
        throw new Error("Request timed out");
      }),
    });
    const result = await sendOrderToErp({}, NEW_ORDER, d);
    expect(result).toStrictEqual({
      erpNumber: "0000001002",
      message:
        "order 3000000004 is ERP sales order 0000001002, but writing the number back to Commerce failed: Request timed out",
      outcome: "failed",
      statusCode: 503,
    });
  });

  test("Then a send with nothing to record still works (the hook is optional)", async () => {
    const result = await sendOrderToErp({}, NEW_ORDER, deps());
    expect(result.outcome).toBe("sent");
  });
});
