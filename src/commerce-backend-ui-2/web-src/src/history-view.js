/*
 * What the History section says about each record (lib/history.js), kept apart from the
 * React that renders it so it can be tested without a browser. Two halves share one list:
 * orders sent to the ERP, and ERP events applied to Commerce.
 */

/** How each outcome reads to a merchant. */
export const RESULT = {
  applied: "Applied",
  dropped: "Not sent",
  failed: "Not applied yet",
  held: "Waiting for the ERP",
  refused: "Refused by Commerce",
  sent: "Sent",
};

const NOT_THROUGH = new Set(["held", "dropped", "failed", "refused"]);

/** What a record is about, by the kind of change. */
const SUBJECT = {
  block: "Company",
  cancel: "Order",
  credit: "Company",
  invoice: "Order",
  order: "Order",
  "order-status": "Order",
  price: "SKU",
  shipment: "Order",
  stock: "SKU",
};

/**
 * Retry is offered for anything that did not get through. Held orders and failed ERP
 * events are also delivered again by I/O Events for up to a day; a person need not wait.
 */
export function canRetry(entry) {
  return NOT_THROUGH.has(entry.outcome);
}

/** The attempts, and who made the last one when it was a person. */
function triesText(entry) {
  const tries = `${entry.attempts} ${entry.attempts === 1 ? "try" : "tries"}`;
  return entry.retriedBy
    ? `${tries}, the last by an ${entry.retriedBy}`
    : tries;
}

/**
 * One row of the section.
 * @param {object} entry a history record
 * @param {string} [erpName] what the ERP is called
 * @returns {object} the row: key, when, direction, what, result, tries, message, and the
 *   Retry it offers (`retry` is the history action's POST body)
 */
export function historyRow(entry, erpName = "the ERP") {
  const fromErp = entry.direction === "from-erp";
  return {
    direction: fromErp ? `From ${erpName}` : `To ${erpName}`,
    key: fromErp ? `erp.${entry.eventId}` : `${entry.kind}.${entry.ref}`,
    message: entry.message,
    result: RESULT[entry.outcome] ?? entry.outcome,
    retriable: canRetry(entry),
    retry: fromErp ? { eventId: entry.eventId } : { incrementId: entry.ref },
    tries: triesText(entry),
    what: `${SUBJECT[entry.kind] ?? entry.kind} ${entry.ref}`,
    when: entry.lastAt,
  };
}
