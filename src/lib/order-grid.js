/*
 * What this ERP's column on Commerce's Sales > Orders grid shows for one order: the ERP's
 * number, when the ERP made one, and where the send stands. Read from the integration's own
 * order history (lib/history.js), so the grid costs no call to the ERP.
 */

/** A send's outcome in the words of a cell. */
const WORDS = {
  failed: "Not sent",
  held: "Waiting for the ERP",
  sending: "Sending",
  sent: "Sent",
};

/**
 * @param {object} [record] the order's history record (`order.<increment id>`)
 * @returns {string|undefined} the cell, or undefined for an order this ERP never saw
 */
export function orderGridCell(record) {
  if (!record) {
    return;
  }
  const word = WORDS[record.outcome] ?? record.outcome;
  return record.erpNumber ? `${record.erpNumber} · ${word}` : word;
}
