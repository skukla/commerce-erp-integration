/*
 * The returns and credit memo half of the fake Commerce (fake-commerce.js): partial invoices,
 * credit memos of some lines, and returns (RMA) read, written back and commented. Shapes are
 * the ones measured on the live store 2026-10-02 (returns-design.md §6.1, R-T2, R-T3): a
 * refund answers the credit memo id as a string; a return written back without its
 * increment_id is given a NEW number, which the fake does too, so a write that drops it shows.
 *
 * The demo reset's calls (the one reset rule, lib/reset-rule.js) are typed from Adobe's docs,
 * NOT captured live: the whole-order offline refund (POST order/{id}/refund with the invoiced
 * lines and shipping; developer.adobe.com/commerce/webapi/rest/tutorials/orders/
 * order-issue-refund/, which says it "Issues an offline refund" and answers the credit memo id),
 * the state Commerce gives the order after it (Closed once nothing is left to invoice or credit:
 * Magento 2.4's order state resolver, as read from its source, not seen live), the order's
 * returns (GET returns by order_id, Adobe's REST reference GetV1Returns, `{ items, total_count }`)
 * and a return's header written to "closed" (PUT returns/{id}; Adobe's returns page names
 * Closed, experienceleague.adobe.com/en/docs/commerce-admin/stores-sales/order-management/
 * returns/returns).
 */
// biome-ignore-all lint/suspicious/useAwait: a fake Commerce answers promises without waiting on anything; the real clients are async and callers await them

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * When an invoice made after checkout is created: an hour and a half after the seeded order
 * (fake-commerce.js, created 10:00:00). Commerce's invoice carries `created_at` (REST
 * sales-data-invoice-interface, read 2026-10-03, NOT captured live), which tells the
 * checkout invoice from one made later (lib/checkout-invoice.js).
 */
export const INVOICED_LATER_AT = "2026-09-24 11:30:00";

const qty = (value) => Number(value ?? 0);

/** Commerce's refusal of a REST call: the client throws, the way ky's HTTPError carries it. */
export function refusal400(message) {
  const error = new Error(
    `Request failed with status code 400 Bad Request: ${message}`,
  );
  error.response = { status: 400, statusCode: 400 };
  return error;
}

/*
 * The states in which Order::canCreditmemo() refuses (Magento 2.4 Sales/Model/Order.php: on hold,
 * in payment review, canceled, closed). The words are as recalled, NOT captured live.
 */
const UNCREDITABLE = ["holded", "payment_review", "canceled", "closed"];

/** Why Commerce refuses an offline refund of the order, or null when it credits it. */
function refundRefusal(o, body) {
  if (UNCREDITABLE.includes(o.state)) {
    return refusal400("The order does not allow a creditmemo to be created.");
  }
  const over = (body.items ?? []).find((asked) => {
    const line = o.items.find((i) => i.item_id === Number(asked.order_item_id));
    return (
      !line || qty(asked.qty) > qty(line.qty_invoiced) - qty(line.qty_refunded)
    );
  });
  if (over) {
    return refusal400(
      "The quantity to refund must not be greater than the unrefunded quantity.",
    );
  }
  const shipping = qty(body.arguments?.shipping_amount);
  if (
    shipping >
    qty(o.base_shipping_invoiced) - qty(o.base_shipping_refunded)
  ) {
    return refusal400("The most money available to refund is less than asked.");
  }
  return null;
}

/** Closed once nothing is left to invoice and nothing left to credit, lines and shipping. */
function fullyCredited(o) {
  const lines = o.items.every(
    (i) =>
      qty(i.qty_ordered) - qty(i.qty_invoiced) - qty(i.qty_canceled) <= 0 &&
      qty(i.qty_refunded) >= qty(i.qty_invoiced),
  );
  return (
    lines && qty(o.base_shipping_refunded) >= qty(o.base_shipping_invoiced)
  );
}

/**
 * @param {{ db: () => object, fulfilmentState: (order: object) => string,
 *   invoiceRefusal: (order: object, items: object[]) => Error|null,
 *   order: (id: number) => object, record: Function,
 *   raiseOrderSave: (order: object) => void }} store the fake's own database (a getter:
 *   a reset replaces it), the state an order takes after an invoice, why Commerce refuses an
 *   invoice, order lookup, write log, and the order save event Commerce raises
 */
export function createFakeReturns({
  db,
  fulfilmentState,
  invoiceRefusal,
  order,
  raiseOrderSave,
  record,
}) {
  // The return save events Commerce raised for the writes below, oldest first.
  const returnSaves = [];
  const nextId = () => {
    const id = db().nextId;
    db().nextId += 1;
    return id;
  };
  const aReturn = (id) => {
    const found = db().returns.get(Number(id));
    if (!found) {
      const error = new Error(`return ${id} not found`);
      error.response = { statusCode: 404 };
      throw error;
    }
    return found;
  };

  const client = {
    addReturnComment: async (_p, returnId, comment) => {
      aReturn(returnId).comments.push({ comment });
      record("returnComment", { comment, returnId: Number(returnId) });
      return true;
    },
    getReturn: async (_p, returnId) => clone(aReturn(returnId)),
    /** POST order/{id}/invoice with items: a partial invoice of those lines. */
    invoiceOrderItems: async (_p, orderId, items) => {
      const o = order(orderId);
      const refusal = invoiceRefusal(o, items);
      if (refusal) {
        throw refusal;
      }
      const id = nextId();
      db().invoices.push({
        created_at: INVOICED_LATER_AT,
        entity_id: id,
        increment_id: String(id),
        items: clone(items),
        order_id: o.entity_id,
        state: 2,
      });
      for (const i of items) {
        const line = o.items.find((x) => x.item_id === i.order_item_id);
        line.qty_invoiced = Number(line.qty_invoiced ?? 0) + i.qty;
      }
      o.state = fulfilmentState(o);
      record("invoice", {
        invoiceId: id,
        items: clone(items),
        orderId: String(orderId),
      });
      return id;
    },
    /** GET returns filtered on the order: the returns' headers, as a search answers them. */
    listOrderReturns: async (_p, orderId) =>
      [...db().returns.values()]
        .filter((r) => r.order_id === Number(orderId))
        .map(({ entity_id, increment_id, order_id, status }) => ({
          entity_id,
          increment_id,
          order_id,
          status,
        })),
    /** POST order/{id}/refund, the reset's whole refund: lines and shipping, offline. */
    refundOrder: async (_p, orderId, body) => {
      const o = order(orderId);
      const refusal = refundRefusal(o, body);
      if (refusal) {
        throw refusal;
      }
      const id = nextId();
      db().creditMemos.push({
        entity_id: id,
        items: clone(body.items),
        order_id: o.entity_id,
        shipping_amount: qty(body.arguments?.shipping_amount),
      });
      for (const i of body.items) {
        const line = o.items.find((x) => x.item_id === i.order_item_id);
        line.qty_refunded = qty(line.qty_refunded) + i.qty;
      }
      o.base_shipping_refunded =
        qty(o.base_shipping_refunded) + qty(body.arguments?.shipping_amount);
      if (fullyCredited(o)) {
        o.state = "closed";
        o.status = "closed";
      }
      record("refundOrder", {
        body: clone(body),
        creditMemoId: id,
        orderId: String(orderId),
      });
      raiseOrderSave(o);
      return String(id);
    },
    refundOrderItems: async (_p, orderId, items, comment) => {
      const o = order(orderId);
      const id = nextId();
      db().creditMemos.push({
        comment,
        entity_id: id,
        items: clone(items),
        order_id: o.entity_id,
      });
      for (const i of items) {
        const line = o.items.find((x) => x.item_id === i.order_item_id);
        line.qty_refunded = Number(line.qty_refunded ?? 0) + i.qty;
      }
      record("refund", {
        comment,
        items: clone(items),
        orderId: String(orderId),
      });
      return String(id);
    },
    // The reason labels the Justrite sandbox answers (GET returnsAttributeMetadata, 2026-10-02).
    returnReasonLabels: () =>
      Promise.resolve(
        new Map([
          ["10", "Wrong Color"],
          ["11", "Wrong Size"],
          ["12", "Out of Service"],
        ]),
      ),
    updateReturn: async (_p, returnId, rma) => {
      const before = aReturn(returnId);
      const next = clone(rma);
      if (!next.increment_id) {
        next.increment_id = String(nextId()).padStart(9, "0");
      }
      // Commerce keeps the items a write leaves out (Justrite, 2026-10-02).
      const sent = new Map(next.items.map((i) => [i.entity_id, i]));
      db().returns.set(Number(returnId), {
        ...next,
        comments: before.comments,
        items: before.items.map((i) => sent.get(i.entity_id) ?? i),
      });
      record("updateReturn", {
        items: next.items.map((i) => [i.entity_id, i.status]),
        returnId: Number(returnId),
        status: next.status,
      });
      returnSaves.push(returnSavedEvent(Number(returnId)));
      return {};
    },
  };

  /** Commerce's observer.rma_save_commit_after for a return, as it is now. */
  function returnSavedEvent(returnId) {
    const r = aReturn(returnId);
    return {
      data: {
        value: {
          entity_id: r.entity_id,
          increment_id: r.increment_id,
          order_id: r.order_id,
          status: r.status,
        },
      },
      type: "observer.rma_save_commit_after",
    };
  }

  return {
    /** A return entered in Commerce (Admin or storefront): Pending, one item per line asked. */
    adminCreateReturn(orderId, lines) {
      const o = order(orderId);
      const id = nextId();
      db().returns.set(id, {
        comments: [],
        entity_id: id,
        increment_id: String(id).padStart(9, "0"),
        items: lines.map((l) => ({
          condition: "9",
          entity_id: nextId(),
          order_item_id: l.order_item_id,
          qty_approved: null,
          qty_authorized: null,
          qty_requested: l.qty,
          qty_returned: null,
          reason: "8",
          resolution: "5",
          rma_entity_id: id,
          status: "pending",
        })),
        order_id: o.entity_id,
        order_increment_id: o.increment_id,
        status: "pending",
        store_id: o.store_id,
      });
      return id;
    },
    client,
    returnSaved: returnSavedEvent,
    returnSaves,
  };
}
