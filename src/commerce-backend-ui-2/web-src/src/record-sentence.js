/*
 * The Record column's sentence, in one grammar for every kind of record (owner, 2026-10-14):
 * "Subject: what happened", the subject being the thing itself ("Order 3000000023",
 * "Product accesspoint", a company's name) and what happened short and lower-case
 * ("shipped", "price 189"). It names no ERP and no type, which their own columns say, and not
 * how the record ended, which Result says.
 *
 * It is built from the record's own fields wherever they exist, not from its message: the
 * messages were written by many modules in many voices (lib/order-sync.js, lib/commerce-changes.js,
 * router/part-fulfilment.js, lib/erp-event-history.js ...), and a row that echoed them read in
 * as many. A message is read only where the fact is in nothing else, by one named pattern.
 */

/** What a Commerce order change did, as lib/commerce-changes.js writes it. */
const CHANGE = /\b(canceled|held|released) on sales order\b/u;
/** The demo reset's own summary, before its first semicolon (lib/detach.js). */
const RESET_WHAT = /^Demo reset on [^:]+: ([^;]+)/u;

const order = (ref) => `Order ${ref}`;
const product = (sku) => `Product ${sku}`;

/** A company by its Commerce name, else the ERP's customer number it was told by. */
function companyOf(entry) {
  const data = entry.event?.data ?? {};
  if (entry.company?.name) {
    return entry.company.name;
  }
  return data.partnerId ? `Customer ${data.partnerId}` : `Company ${entry.ref}`;
}

/** A count with its noun: "1 customer price", "3 customer prices". */
const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** One stock line: "42 in stock at east", "out of stock at east". */
function stockLine(line) {
  const at = line.source ? ` at ${line.source}` : "";
  return line.outOfStock
    ? `out of stock${at}`
    : `${line.quantity} in stock${at}`;
}

/** Stock from an ERP: a list of lines (stock/external/updated/schema.json). */
function stockSentence(entry) {
  const data = entry.event?.data;
  const lines = Array.isArray(data) ? data : [data ?? {}];
  if (lines.length === 1) {
    return lines[0].sku
      ? `${product(lines[0].sku)}: ${stockLine(lines[0])}`
      : null;
  }
  return `${counted(lines.length, "product", "products")}: stock changed`;
}

/** Records an ERP sent (lib/erp-event-history.js), by their event's data. */
const FROM_ERP = {
  block: (e, d) => `${companyOf(e)}: ${d.blocked ? "blocked" : "unblocked"}`,
  cancel: (e) => `${order(e.ref)}: canceled`,
  contract: (e, d) =>
    `${companyOf(e)}: ${counted(Array.isArray(d.lines) ? d.lines.length : 0, "customer price", "customer prices")}`,
  credit: (e, d) => `${companyOf(e)}: credit limit ${d.creditLimit}`,
  "credit-memo": (e, d) => `${order(e.ref)}: credit memo ${d.creditMemoNumber}`,
  hold: (e, d) =>
    `${order(e.ref)}: ${d.held ? "on credit hold" : "credit hold released"}`,
  invoice: (e) => `${order(e.ref)}: invoiced`,
  "order-status": (e, d) => `${order(e.ref)}: ${d.status}`,
  payment: (e, d) =>
    `${order(e.ref)}: paid ${d.amount}${d.currency ? ` ${d.currency}` : ""}`,
  price: (e, d) => `${product(d.sku ?? e.ref)}: price ${d.price}`,
  return: (e, d) => `${order(e.ref)}: return order ${d.returnNumber} received`,
  shipment: (e) => `${order(e.ref)}: shipped`,
  stock: (e) => stockSentence(e),
};

/**
 * The event fields each kind's sentence is made of. A record without them (an old one, or one
 * written by hand) falls back to its message rather than reading "undefined".
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

/** What an order record says happened: its ERP sales order once there is one. */
function orderSentence(entry) {
  return entry.erpNumber
    ? `${order(entry.ref)}: sales order ${entry.erpNumber}`
    : order(entry.ref);
}

/** Records the integration made of a change in Commerce, or of its own work. */
const OWN = {
  changed: (e) => {
    const done = CHANGE.exec(String(e.message ?? ""));
    return `${order(e.orderRef ?? e.ref)}: ${done ? done[1] : "changed"}`;
  },
  invoiced: (e) =>
    `Invoice ${e.ref}${e.orderRef ? `: order ${e.orderRef}` : ""}`,
  order: orderSentence,
  "product-changed": (e) => `${product(e.ref)}: name and price`,
  "product-deleted": (e) => `${product(e.ref)}: deleted`,
  reset: (e) => {
    const what = RESET_WHAT.exec(String(e.message ?? ""));
    return what ? `Demo reset: ${what[1].trim()}` : "Demo reset";
  },
  returned: (e) =>
    `Return ${e.ref}${e.orderRef ? `: order ${e.orderRef}` : ""}`,
  shipped: (e) =>
    `Shipment ${e.ref}${e.orderRef ? `: order ${e.orderRef}` : ""}`,
};

/**
 * The Record column's sentence for one record, or null for a kind this grammar does not know
 * (the row then falls back to its message).
 * @param {object} entry the history record
 * @returns {string|null}
 */
export function recordSentence(entry) {
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
