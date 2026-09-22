/*
 * What the History section says about each record (lib/history.js), kept apart from the
 * React that renders it so it can be tested without a browser.
 */

/** How each outcome reads to a merchant. */
export const RESULT = {
  dropped: "Not sent",
  held: "Waiting for the ERP",
  sent: "Sent",
};

/**
 * Retry is offered for an order that did not get through. A held order is also delivered
 * again by I/O Events for up to a day; a person need not wait for that.
 */
export function canRetry(entry) {
  return entry.outcome === "held" || entry.outcome === "dropped";
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
 * @returns {{ key: string, order: string, result: string, tries: string, when: string, message: string, retriable: boolean }}
 */
export function historyRow(entry) {
  return {
    key: `${entry.kind}.${entry.ref}`,
    message: entry.message,
    order: entry.ref,
    result: RESULT[entry.outcome] ?? entry.outcome,
    retriable: canRetry(entry),
    tries: triesText(entry),
    when: entry.lastAt,
  };
}
