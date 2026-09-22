/*
 * What the "Follow an order" section says about one order, kept apart from the React that
 * renders it (as history-view.js is). The action does the gathering; this decides the
 * words: where each step happened, and whether it is a failure the page offers to retry.
 */

/** Where a step happened, as the page labels it. */
const WHERE = {
  commerce: "Commerce",
  erp: "ERP",
  integration: "Integration",
};

/** The outcomes that mean a step did not get through (lib/history.js keeps the same set). */
const NOT_THROUGH = new Set(["held", "dropped", "failed", "refused"]);

/**
 * One step as a row: when, where, what, and — when it did not get through — the retry.
 *
 * @param {object} step a step from the trace
 * @param {number} index its position, which makes the row's key
 * @returns {object} the row
 */
export function traceRow(step, index) {
  return {
    at: step.at,
    detail: step.detail ?? "",
    failed: NOT_THROUGH.has(step.outcome),
    key: `${index}-${step.at}`,
    retry: step.retry ?? null,
    tries: step.tries ? `${step.tries} tries` : "",
    what: step.what,
    where: WHERE[step.where] ?? step.where,
  };
}

/**
 * The one line that answers "where is this order?", from the trace's summary.
 *
 * @param {object} summary the trace summary
 * @param {string} erpName what the SC calls this ERP
 * @returns {string} the sentence the section leads with
 */
export function traceHeadline(summary, erpName) {
  if (!summary?.incrementId) {
    return "No order with that number.";
  }
  if (!summary.reachedErp) {
    return summary.erpNumber
      ? `Order ${summary.incrementId} is ${erpName} order ${summary.erpNumber}, which ${erpName} did not answer for.`
      : `Order ${summary.incrementId} has not reached ${erpName}.`;
  }
  return `Order ${summary.incrementId} is ${erpName} order ${summary.erpNumber}: ${summary.erpStatus} there, ${summary.commerceStatus} in Commerce.`;
}
