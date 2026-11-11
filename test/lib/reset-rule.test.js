/*
 * The ONE reset rule (owner, 2026-10-30; changed 2026-11-11), shared with Demo Builder's Clear:
 * what a reset does to each order, decided from the order alone. The cases are the owner's, named
 * as Demo Builder's suite names them (reset-rule-orders.js).
 */
import {
  cancellableByReset,
  hasResetNote,
  LEFT_OPEN_NOTE,
  leadingNoteOf,
  openReturns,
  refundedNote,
  refundedOpenNote,
  refundOf,
  removedNote,
  resetNoteDayOf,
  resetPlanOf,
} from "#lib/reset-rule";

import { RESET_RULE_CASES } from "./reset-rule-orders.js";

/** What the rule does, in the words Demo Builder's suite expects. */
const OUTCOME = { cancel: "canceled", note: "noted", refund: "refunded" };
const outcomeOf = (plan) =>
  plan === "done" ? "untouched" : OUTCOME[plan.action];

describe("Given the example orders of the one reset rule", () => {
  test.each(RESET_RULE_CASES.map((c) => [c.name, c]))(
    "%s",
    (_name, { order, returns, expected, closesReturn, invoices }) => {
      const plan = resetPlanOf(order);
      expect(outcomeOf(plan)).toBe(expected);
      if (plan !== "done") {
        expect(plan.invoice).toBe(invoices === true);
        expect(plan.noted).toBe(false);
      }
      expect(openReturns(returns).map((r) => r.entity_id)).toEqual(
        closesReturn === undefined ? [] : [closesReturn],
      );
    },
  );

  test("Then a refund credits every invoiced line and the shipping not yet refunded, offline, nothing more", () => {
    const [, invoiced, shipped] = RESET_RULE_CASES;
    expect(refundOf(invoiced.order)).toEqual({
      arguments: {
        adjustment_negative: 0,
        adjustment_positive: 0,
        shipping_amount: 10,
      },
      items: [{ order_item_id: 72, qty: 1 }],
      notify: false,
    });
    expect(refundOf(shipped.order).items).toEqual([
      { order_item_id: 73, qty: 3 },
    ]);
    expect(refundOf(shipped.order).arguments.shipping_amount).toBe(5);
  });
});

test("Then a partly invoiced order, as read before its invoice, would refund only its invoiced line and the invoiced shipping", () => {
  const partly = RESET_RULE_CASES.find((c) => c.name.startsWith("partly"));
  expect(refundOf(partly.order)).toEqual({
    arguments: {
      adjustment_negative: 0,
      adjustment_positive: 0,
      shipping_amount: 5,
    },
    items: [{ order_item_id: 77, qty: 1 }],
    notify: false,
  });
});

describe("Given an order the five cases do not cover", () => {
  const line = (extra) => ({
    item_id: 1,
    qty_canceled: 0,
    qty_invoiced: 0,
    qty_ordered: 2,
    qty_refunded: 0,
    qty_shipped: 0,
    ...extra,
  });

  test("Then shipped but never invoiced is invoiced first, then refunded: the rule cancels nothing shipped", () => {
    const order = {
      items: [line({ qty_shipped: 2 })],
      state: "processing",
    };
    expect(cancellableByReset(order)).toBe(false);
    expect(refundOf(order)).toBeNull();
    expect(resetPlanOf(order)).toEqual({
      action: "refund",
      invoice: true,
      noted: false,
      unhold: false,
    });
  });

  test("Then an order in payment review is only noted: Commerce neither invoices nor credits there (Order::canCreditmemo)", () => {
    const order = {
      items: [line({ qty_invoiced: 2 })],
      state: "payment_review",
    };
    expect(resetPlanOf(order)).toEqual({
      action: "note",
      invoice: false,
      noted: false,
      unhold: false,
    });
  });

  test("Then an order with nothing to invoice and nothing left to refund is only noted", () => {
    const order = {
      items: [line({ qty_invoiced: 2, qty_refunded: 2, qty_shipped: 2 })],
      state: "complete",
    };
    expect(resetPlanOf(order).action).toBe("note");
  });

  test("Then a held invoiced order is released, then refunded", () => {
    const order = { items: [line({ qty_invoiced: 2 })], state: "holded" };
    expect(resetPlanOf(order)).toEqual({
      action: "refund",
      invoice: false,
      noted: false,
      unhold: true,
    });
  });

  test("Then a canceled order is done", () => {
    expect(resetPlanOf({ items: [line()], state: "canceled" })).toBe("done");
  });

  test("Then an order a reset left open (its note says so) is done, even in payment review", () => {
    const order = {
      items: [line({ qty_invoiced: 2 })],
      state: "payment_review",
      status_histories: [{ comment: removedNote("2026-11-10") }],
    };
    expect(resetPlanOf(order)).toBe("done");
  });

  test("Then an order a stopped run noted but did not close is planned again, marked as noted", () => {
    const order = {
      items: [line({ qty_invoiced: 1 })],
      state: "processing",
      status_histories: [{ comment: refundedNote("2026-11-10") }],
    };
    expect(resetPlanOf(order)).toEqual({
      action: "refund",
      invoice: true,
      noted: true,
      unhold: false,
    });
  });

  test("Then the note an order's work starts with is decided from its plan", () => {
    expect(leadingNoteOf("cancel", "2026-11-11")).toBe(
      "Canceled by the demo reset on 2026-11-11.",
    );
    expect(leadingNoteOf("refund", "2026-11-11")).toBe(
      "Refunded and closed by the demo reset on 2026-11-11.",
    );
    expect(leadingNoteOf("note", "2026-11-11")).toBe(
      "The ERP documents for this order were removed by the demo reset on 2026-11-11.",
    );
    expect(removedNote("2026-11-11").startsWith(LEFT_OPEN_NOTE)).toBe(true);
  });

  test("Then the day a reset's note names is read back, newest note first; none without a note", () => {
    expect(
      resetNoteDayOf({
        status_histories: [
          { comment: "Shipped." },
          { comment: refundedNote("2026-11-11") },
          { comment: removedNote("2026-11-10") },
        ],
      }),
    ).toBe("2026-11-11");
    expect(
      resetNoteDayOf({ status_histories: [{ comment: "Shipped." }] }),
    ).toBeNull();
    expect(resetNoteDayOf({})).toBeNull();
  });

  test("Then a configurable's child line is left out of the refund: Commerce credits the parent", () => {
    const order = {
      items: [
        line({ item_id: 1, qty_invoiced: 2 }),
        line({ item_id: 2, parent_item_id: 1, qty_invoiced: 2 }),
      ],
      state: "processing",
    };
    expect(refundOf(order).items).toEqual([{ order_item_id: 1, qty: 2 }]);
  });

  test("Then what was refunded already is not refunded again, and a fully refunded order has nothing to refund", () => {
    const part = {
      base_shipping_invoiced: 5,
      base_shipping_refunded: 5,
      items: [line({ qty_invoiced: 2, qty_refunded: 1 })],
      state: "processing",
    };
    expect(refundOf(part)).toEqual(
      expect.objectContaining({
        arguments: expect.objectContaining({ shipping_amount: 0 }),
        items: [{ order_item_id: 1, qty: 1 }],
      }),
    );
    const all = { items: [line({ qty_invoiced: 2, qty_refunded: 2 })] };
    expect(refundOf(all)).toBeNull();
  });

  test("Then the note of a refund Commerce kept open says so, and a second run knows it too", () => {
    expect(refundedOpenNote("2026-10-30")).toBe(
      "Refunded the invoiced items by the demo reset on 2026-10-30.",
    );
    expect(
      hasResetNote({
        status_histories: [{ comment: refundedOpenNote("2026-10-30") }],
      }),
    ).toBe(true);
  });

  test("Then the refund's note carries the words a second run looks for", () => {
    expect(
      hasResetNote({
        status_histories: [{ comment: refundedNote("2026-10-30") }],
      }),
    ).toBe(true);
    expect(refundedNote("2026-10-30")).toBe(
      "Refunded and closed by the demo reset on 2026-10-30.",
    );
  });

  test("Then a return already closed, or processed and closed, is not open", () => {
    expect(
      openReturns([
        { entity_id: 1, status: "closed" },
        { entity_id: 2, status: "processed_closed" },
        { entity_id: 3, status: "pending" },
        { entity_id: 4, status: "received" },
      ]).map((r) => r.entity_id),
    ).toEqual([3, 4]);
  });
});
