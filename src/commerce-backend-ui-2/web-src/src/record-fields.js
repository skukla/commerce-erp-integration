/*
 * One history record as the log shows it (owner, 2026-10-14): the record in Commerce and the
 * same record in the ERP, each by its own name and number, and a plain phrase for what
 * happened in the system the record came from, under the heading "Details".
 *
 *   commerce  "Order 3000000023", "Shipment 3000000012", "Kukla Studios", "accesspoint"
 *   erp       "Sales order 0000001013", "Customer 100042", "Payment P-17", "accesspoint"
 *   details   "Price changed to 189.00", "Credit hold placed", "Order shipped"
 *
 * The phrase is about the source system's side, so it stays true whatever Result says: "Price
 * changed to 189.00" happened in the ERP, and Result "Failed" says Commerce did not take it.
 * The vocabulary is fixed, one phrase per kind (.rptc/plans/erp-admin-one-home in Demo
 * Builder). The owner found "Label: value" pairs read like a database dump.
 *
 * Built from the record's own fields, not its message: the messages were written by many
 * modules in many voices. A message is read only where the fact is in nothing else, by one
 * named pattern below.
 */

/** A Commerce order change, as lib/commerce-changes.js writes it: what, and on which order. */
const CHANGE = /\b(canceled|held|released) on sales order (\S+)/u;
/** A Commerce shipment or invoice recorded on one ERP's order (lib/commerce-changes.js). */
const RECORDED_ON = /recorded on sales order (\S+)/u;
/** Each ERP's part of a split order (lib/order-sync.js). */
const TOOK_PART = /took its part as sales order (\S+?)\.?(?:\s|$)/gu;
/** A return sent to an ERP (router/return-pieces.js). */
const RETURN_ORDER = /as return order (\S+?)\.?(?:\s|$)/gu;
/** The demo reset's own summary, before its first semicolon (lib/detach.js). */
const RESET_WHAT = /^Demo reset on [^:]+: ([^;]+)/u;

const MONEY = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const COUNT = new Intl.NumberFormat("en-US");

/** A money amount as the Admin writes one: "25,000.00", or the value as given if not a number. */
function money(value, currency) {
  const n = Number(value);
  const shown = Number.isFinite(n) ? MONEY.format(n) : String(value);
  return currency ? `${shown} ${currency}` : shown;
}

/**
 * A row's fields. `missing` names a side that is absent where its absence is the point
 * ("Not paired", "Not in the ERP yet"); an unknown side is just empty.
 */
const row = (commerce, erp, details = "", missing = {}) => ({
  commerce,
  details,
  erp,
  missing,
});
const message = (entry) => String(entry.message ?? "");
/** Every number one pattern finds in the record's message, joined. */
function numbersIn(entry, pattern) {
  return [...message(entry).matchAll(pattern)].map((m) => m[1]).join(", ");
}

const commerceOrder = (ref) => `Order ${ref}`;
const salesOrder = (number) => (number ? `Sales order ${number}` : "");
/** An order no ERP holds: on its way ("yet"), or refused, or none at all once sent. */
function notInErp(numbers, outcome) {
  if (numbers || outcome === "sent") {
    return {};
  }
  return {
    erp: outcome === "dropped" ? "Not in the ERP" : "Not in the ERP yet",
  };
}

/** One sales order, or a split order's several: "Sales orders 13, 2". */
const salesOrders = (numbers) =>
  numbers.includes(",") ? `Sales orders ${numbers}` : salesOrder(numbers);

/** A count with its noun: "1 customer price", "3 customer prices". */
const counted = (n, one, many) => `${COUNT.format(n)} ${n === 1 ? one : many}`;

/**
 * A company: by its Commerce name, and the ERP's customer number it is paired with. A customer
 * no Commerce company is paired with says so: that is often why the record did not apply.
 */
function companyRow(entry, details) {
  const partner = entry.event?.data?.partnerId ?? entry.ref;
  const name = entry.company?.name ?? "";
  return row(
    name,
    partner ? `Customer ${partner}` : "",
    details,
    name ? {} : { commerce: "Not paired" },
  );
}

/** Stock lines from an ERP: a list (stock/external/updated/schema.json). */
function stockRow(entry) {
  const data = entry.event?.data;
  const lines = Array.isArray(data) ? data : [data ?? {}];
  if (lines.length !== 1) {
    return row(
      "",
      "",
      `Stock changed for ${counted(lines.length, "product", "products")}`,
    );
  }
  const [line] = lines;
  if (!line.sku) {
    return null;
  }
  const at = line.source ? ` at ${line.source}` : "";
  // A product is the same SKU on both sides: the ERP's side adds nothing.
  return row(
    line.sku,
    "",
    line.outOfStock
      ? `Out of stock${at}`
      : `Stock changed to ${COUNT.format(line.quantity ?? 0)}${at}`,
  );
}

/**
 * An order event an ERP sent: the order on both sides, the ERP's side always its sales order
 * (the same business record). The event's own document, a payment or an invoice, is named in
 * Details instead, so the column means one thing.
 */
const erpOrder = (entry, details) =>
  row(
    commerceOrder(entry.ref),
    salesOrder(entry.event?.data?.erpNumber),
    details,
  );

/** Records an ERP sent (lib/erp-event-history.js), by their event's data. */
const FROM_ERP = {
  block: (e, d) =>
    companyRow(e, d.blocked ? "Company blocked" : "Company unblocked"),
  cancel: (e) => erpOrder(e, "Order canceled"),
  contract: (e, d) =>
    companyRow(
      e,
      `${counted(d.lines.length, "customer price", "customer prices")} updated`,
    ),
  credit: (e, d) =>
    companyRow(e, `Credit limit changed to ${money(d.creditLimit)}`),
  "credit-memo": (e, d) =>
    erpOrder(e, `Credit memo ${d.creditMemoNumber} issued`),
  hold: (e, d) =>
    erpOrder(e, d.held ? "Credit hold placed" : "Credit hold released"),
  invoice: (e, d) =>
    erpOrder(
      e,
      d.invoiceNumber ? `Invoice ${d.invoiceNumber} issued` : "Order invoiced",
    ),
  "order-status": (e, d) => erpOrder(e, `Order ${d.status}`),
  payment: (e, d) => {
    const amount = money(d.amount, d.currency);
    return erpOrder(
      e,
      d.paymentNumber
        ? `Payment ${d.paymentNumber} of ${amount} received`
        : `Payment of ${amount} received`,
    );
  },
  // A product is the same SKU on both sides: the ERP's side adds nothing.
  price: (e, d) =>
    row(d.sku ?? e.ref, "", `Price changed to ${money(d.price)}`),
  return: (e, d) => erpOrder(e, `Return order ${d.returnNumber} received`),
  shipment: (e) => erpOrder(e, "Order shipped"),
  stock: (e) => stockRow(e),
};

/**
 * The event fields each kind is shown by. A record without them (an old one, or one written
 * by hand) falls back to its message rather than reading "undefined".
 */
const NEEDS = {
  block: ["blocked"],
  contract: ["lines"],
  credit: ["creditLimit"],
  "credit-memo": ["creditMemoNumber"],
  hold: ["held"],
  "order-status": ["status"],
  payment: ["amount"],
  price: ["price"],
  return: ["returnNumber"],
};

const hasAll = (data, names) =>
  names.every((name) => data[name] !== undefined && data[name] !== null);

/** A Commerce shipment, invoice or return: the document, and that it was created. */
const commerceDocument = (noun, erpSide) => (e) =>
  row(`${noun} ${e.ref}`, erpSide(e), `${noun} created`);

/** Records the integration made of a change in Commerce, or of its own work. */
const OWN = {
  changed: (e) => {
    const done = CHANGE.exec(message(e));
    return row(
      commerceOrder(e.orderRef ?? e.ref),
      done ? salesOrder(done[2]) : "",
      done ? `Order ${done[1]}` : "Order changed",
    );
  },
  invoiced: commerceDocument("Invoice", (e) =>
    salesOrder(RECORDED_ON.exec(message(e))?.[1]),
  ),
  order: (e) => {
    const numbers = e.erpNumber ?? numbersIn(e, TOOK_PART);
    // An order on its way that no ERP holds yet says so: that is what Result waits on.
    return row(
      commerceOrder(e.ref),
      salesOrders(numbers),
      "Order placed",
      notInErp(numbers, e.outcome),
    );
  },
  // A save sends the name and price whatever changed, so it reads "changed", not "renamed".
  "product-changed": (e) => row(e.ref, "", "Product changed"),
  "product-deleted": (e) => row(e.ref, "", "Product deleted"),
  reset: (e) => {
    // "21 orders canceled, 3 noted as closed" or "no orders to close" (lib/detach.js).
    const what = RESET_WHAT.exec(message(e))?.[1]?.trim();
    return row("", "", what ? `Demo reset: ${what}` : "Demo reset");
  },
  returned: commerceDocument("Return", (e) => {
    const numbers = numbersIn(e, RETURN_ORDER);
    return numbers ? `Return order ${numbers}` : "";
  }),
  shipped: commerceDocument("Shipment", (e) =>
    salesOrder(RECORDED_ON.exec(message(e))?.[1]),
  ),
};

/**
 * One record's two sides and its fact, or null for a kind this does not know (the row then
 * falls back to its message).
 * @param {object} entry the history record
 * @returns {{ commerce: string, erp: string, details: string } | null}
 */
export function recordFields(entry) {
  if (entry.direction === "from-erp") {
    const build = FROM_ERP[entry.kind];
    const data = entry.event?.data ?? {};
    if (
      !(build && (Array.isArray(data) || hasAll(data, NEEDS[entry.kind] ?? [])))
    ) {
      return null;
    }
    return build(entry, data);
  }
  const build = OWN[entry.kind];
  return build ? build(entry) : null;
}

/**
 * The same as one line, where there are no columns to read it in (Needs attention until it
 * is a table): "Order placed: Order 3000000026".
 */
export function recordLine({ commerce, details, erp }) {
  return [details, commerce || erp].filter(Boolean).join(": ");
}
