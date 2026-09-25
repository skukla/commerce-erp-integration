/*
 * One order's whole life, in one list: placed in Commerce, sent to the ERP (or held, and
 * why), the ERP's number written back, then what the ERP did with it.
 *
 * The pieces come from three places that each know part of it, and none of them knows the
 * order of events — that is what this builds.
 */
import { buildOrderTrace } from "#lib/order-trace";

const COMMERCE_ORDER = {
  created_at: "2026-09-20T09:00:00Z",
  ext_order_id: "0000001042",
  grand_total: 240,
  increment_id: "000000042",
  status: "processing",
};

const ERP_ORDER = {
  history: [
    { at: "2026-09-20T09:00:30Z", status: "created" },
    { at: "2026-09-20T10:15:00Z", status: "confirmed" },
    { at: "2026-09-21T08:00:00Z", status: "shipped" },
  ],
  number: "0000001042",
  status: "shipped",
  total: 240,
};

const SENT = {
  attempts: 1,
  direction: "to-erp",
  firstAt: "2026-09-20T09:00:20Z",
  kind: "order",
  lastAt: "2026-09-20T09:00:25Z",
  message: "order 000000042 is ERP sales order 0000001042.",
  outcome: "sent",
  ref: "000000042",
};

const SHIPPED_BACK = {
  attempts: 1,
  direction: "from-erp",
  eventId: "ev-9",
  firstAt: "2026-09-21T08:00:05Z",
  kind: "shipment",
  lastAt: "2026-09-21T08:00:05Z",
  message: "order 000000042: shipped",
  outcome: "applied",
  ref: "000000042",
};

describe("Given one order followed end to end", () => {
  test("Then every step is there, oldest first, each saying where it happened", () => {
    const trace = buildOrderTrace({
      commerceOrder: COMMERCE_ORDER,
      crossings: [SHIPPED_BACK, SENT],
      erpName: "Northwind ERP",
      erpOrder: ERP_ORDER,
    });

    expect(trace.steps.map((step) => [step.where, step.what])).toStrictEqual([
      ["commerce", "Order 000000042 placed"],
      ["integration", "Sent to Northwind ERP"],
      ["erp", "Northwind ERP created sales order 0000001042"],
      ["erp", "Northwind ERP confirmed it"],
      ["erp", "Northwind ERP shipped it"],
      ["integration", "Shipment applied to Commerce"],
    ]);
    expect(trace.steps.every((step) => step.at)).toBe(true);
  });

  test("Then the order's two numbers and its state on both sides are the summary", () => {
    const trace = buildOrderTrace({
      commerceOrder: COMMERCE_ORDER,
      crossings: [SENT],
      erpName: "Northwind ERP",
      erpOrder: ERP_ORDER,
    });

    expect(trace.summary).toStrictEqual({
      commerceAnswered: true,
      commerceStatus: "processing",
      erpNumber: "0000001042",
      erpStatus: "shipped",
      incrementId: "000000042",
      reachedErp: true,
    });
  });

  // The demo moment: the ERP was down, the order is sitting there, and the page says so.
  test("Then an order that never got through says so, and the ERP half is simply absent", () => {
    const held = {
      ...SENT,
      attempts: 4,
      message: "order 000000042 is waiting for Northwind ERP.",
      outcome: "held",
    };

    const trace = buildOrderTrace({
      commerceOrder: COMMERCE_ORDER,
      crossings: [held],
      erpName: "Northwind ERP",
      erpOrder: null,
    });

    expect(trace.summary.reachedErp).toBe(false);
    expect(trace.summary.erpStatus).toBeNull();
    expect(trace.steps.map((step) => step.what)).toStrictEqual([
      "Order 000000042 placed",
      "Waiting for Northwind ERP",
    ]);
    expect(trace.steps.at(-1)).toMatchObject({
      detail: "order 000000042 is waiting for Northwind ERP.",
      outcome: "held",
      retry: { incrementId: "000000042" },
      tries: 4,
    });
  });

  test("Then an order Commerce does not have is an empty trace, not a guess", () => {
    const trace = buildOrderTrace({
      commerceOrder: null,
      crossings: [],
      erpName: "Northwind ERP",
      erpOrder: null,
    });

    expect(trace.steps).toStrictEqual([]);
    expect(trace.summary).toMatchObject({ reachedErp: false });
  });

  // An ERP event that could not be applied belongs in the story: it is the reason
  // Commerce and the ERP disagree, and it is retriable from here.
  test("Then a status that did not reach Commerce is shown as the failure it is", () => {
    const refused = {
      ...SHIPPED_BACK,
      message: "order 000000042: shipped — not applied: no such order",
      outcome: "refused",
    };

    const trace = buildOrderTrace({
      commerceOrder: COMMERCE_ORDER,
      crossings: [refused],
      erpName: "Northwind ERP",
      erpOrder: ERP_ORDER,
    });

    expect(trace.steps.at(-1)).toMatchObject({
      outcome: "refused",
      retry: { eventId: "ev-9" },
      what: "Shipment not applied to Commerce",
      where: "integration",
    });
  });
});
