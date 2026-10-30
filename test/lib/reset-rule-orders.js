/*
 * The five example orders of the ONE reset rule (owner, 2026-10-30), shared with Demo Builder's
 * store wipe. The case names are the owner's, word for word, and the bodies are the ones Demo
 * Builder's suite uses (demo-builder-vscode tests/helpers/resetRuleOrders.ts), so the two suites
 * can be compared line by line. Shaped as `GET orders/{id}` and `GET returns/{id}` answer; none
 * of these bodies is captured from a live store.
 */

/** The store view every example was placed in (Demo Builder's test website). */
export const RESET_RULE_VIEW = 6;

const line = (item, qty, invoiced = 0, shipped = 0) => ({
  item_id: item,
  qty_canceled: 0,
  qty_invoiced: invoiced,
  qty_ordered: qty,
  qty_refunded: 0,
  qty_shipped: shipped,
  sku: `RULE-${item}`,
});

const openReturn = (id, orderId, number) => ({
  comments: [],
  customer_custom_email: "",
  customer_id: 70,
  date_requested: "2026-10-30 10:00:00",
  entity_id: id,
  increment_id: `R${id}`,
  items: [],
  order_id: orderId,
  order_increment_id: number,
  status: "authorized",
  store_id: RESET_RULE_VIEW,
  tracks: [],
});

/**
 * @type {Array<{ name: string, order: object, returns: object[],
 *   expected: "canceled"|"refunded"|"untouched", closesReturn?: number }>}
 */
export const RESET_RULE_CASES = [
  {
    expected: "canceled",
    name: "(1) pending, nothing invoiced → canceled",
    order: {
      entity_id: 701,
      increment_id: "000000701",
      items: [line(71, 2)],
      state: "new",
      status: "pending",
      store_id: RESET_RULE_VIEW,
    },
    returns: [],
  },
  {
    expected: "refunded",
    name: "(2) invoiced, not shipped → refunded, closed",
    order: {
      base_shipping_invoiced: 10,
      base_shipping_refunded: 0,
      entity_id: 702,
      increment_id: "000000702",
      items: [line(72, 1, 1)],
      state: "processing",
      status: "processing",
      store_id: RESET_RULE_VIEW,
    },
    returns: [],
  },
  {
    expected: "refunded",
    name: "(3) invoiced and shipped → refunded, closed",
    order: {
      base_shipping_invoiced: 5,
      base_shipping_refunded: 0,
      entity_id: 703,
      increment_id: "000000703",
      items: [line(73, 3, 3, 3)],
      state: "complete",
      status: "complete",
      store_id: RESET_RULE_VIEW,
    },
    returns: [],
  },
  {
    closesReturn: 40,
    expected: "refunded",
    name: "(4) invoiced with an open return → refunded, closed, return closed",
    order: {
      base_shipping_invoiced: 0,
      base_shipping_refunded: 0,
      entity_id: 704,
      increment_id: "000000704",
      items: [line(74, 1, 1, 1)],
      state: "complete",
      status: "complete",
      store_id: RESET_RULE_VIEW,
    },
    returns: [openReturn(40, 704, "000000704")],
  },
  {
    expected: "untouched",
    name: "(5) already closed → untouched",
    order: {
      entity_id: 705,
      increment_id: "000000705",
      items: [{ ...line(75, 1, 1, 1), qty_refunded: 1 }],
      state: "closed",
      status: "closed",
      store_id: RESET_RULE_VIEW,
    },
    returns: [],
  },
];
