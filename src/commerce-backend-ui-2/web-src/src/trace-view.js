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

/** How a part not yet with its ERP stands, by its status (lib/order-parts.js). */
const PART_WAITS = {
  failed: "was not taken (failed)",
  held: "waits (held)",
  sending: "is being sent",
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
  const missing =
    summary.commerceAnswered === false
      ? "Commerce did not answer, so its part of this order is missing. "
      : "";
  const erps = summary.erps ?? [];
  return (
    missing +
    (erps.length > 1
      ? partsHeadline(summary, erps)
      : erpHeadline(summary, erpName))
  );
}

/** What each ERP's part says, with several ERPs: one sentence per part, in list order. */
function partsHeadline(summary, erps) {
  const inCommerce = summary.commerceStatus
    ? `, ${summary.commerceStatus} in Commerce`
    : "";
  const each = erps.map((side) => {
    if (!side.number) {
      return `${side.name}: its part ${PART_WAITS[side.part] ?? `is ${side.part}`}.`;
    }
    return side.status
      ? `${side.name} order ${side.number}: ${side.status} there.`
      : `${side.name} order ${side.number}: ${side.name} did not answer for it.`;
  });
  return [
    `Order ${summary.incrementId} is in ${erps.length} parts${inCommerce}.`,
    ...each,
  ].join(" ");
}

/** What the ERP half says about the order. */
function erpHeadline(summary, erpName) {
  if (!summary.reachedErp) {
    return summary.erpNumber
      ? `Order ${summary.incrementId} is ${erpName} order ${summary.erpNumber}, which ${erpName} did not answer for.`
      : `Order ${summary.incrementId} has not reached ${erpName}.`;
  }
  const inCommerce = summary.commerceStatus
    ? `, ${summary.commerceStatus} in Commerce`
    : "";
  return `Order ${summary.incrementId} is ${erpName} order ${summary.erpNumber}: ${summary.erpStatus} there${inCommerce}.`;
}
