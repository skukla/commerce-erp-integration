/*
 * The returns and credit memo half of the fake Commerce (fake-commerce.js): partial invoices,
 * credit memos of some lines, and returns (RMA) read, written back and commented. Shapes are
 * the ones measured on the live store 2026-10-02 (returns-design.md §6.1, R-T2, R-T3): a
 * refund answers the credit memo id as a string; a return written back without its
 * increment_id is given a NEW number, which the fake does too, so a write that drops it shows.
 */
// biome-ignore-all lint/suspicious/useAwait: a fake Commerce answers promises without waiting on anything; the real clients are async and callers await them

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * @param {{ db: () => object, order: (id: number) => object, record: Function }} store the
 *   fake's own database (a getter: a reset replaces it), order lookup and write log
 */
export function createFakeReturns({ db, order, record }) {
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
      const id = nextId();
      db().invoices.push({
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
      record("invoice", {
        invoiceId: id,
        items: clone(items),
        orderId: String(orderId),
      });
      return id;
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
      db().returns.set(Number(returnId), {
        ...next,
        comments: before.comments,
      });
      record("updateReturn", {
        items: next.items.map((i) => [i.entity_id, i.status]),
        returnId: Number(returnId),
        status: next.status,
      });
      return {};
    },
  };

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
    /** Commerce's observer.rma_save_commit_after for a return, as it is now. */
    returnSaved: (returnId) => {
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
    },
  };
}
