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

/** Where a part not yet with a number stands, in the words of a cell. */
const PART_WORDS = {
  cancelled: "canceled",
  failed: "not sent",
  held: "waiting",
  sending: "sending",
  sent: "sent",
};

/**
 * With several ERPs: the ERP column's cell from the order's parts (lib/order-parts.js). A split
 * order has no single ERP number (no one part writes ext_order_id), and the column is labelled
 * with the first ERP's name, so each part is named by its ERP, with its number or where it stands.
 * @param {{ parts?: object }} [record] the order's parts record
 * @param {{ id: string, name: string }[]} erps the ERP list, for the order and the names
 * @returns {string|undefined} e.g. "Split: Northwind ERP 0000001000; Contoso ERP waiting", or
 *   undefined for an order with no parts
 */
export function partsNumbersCell(record, erps) {
  const parts = record?.parts ?? {};
  const listed = erps.filter((entry) => parts[entry.id]).map((e) => e.id);
  const ids = [
    ...listed,
    ...Object.keys(parts).filter((id) => !listed.includes(id)),
  ];
  if (ids.length === 0) {
    return;
  }
  const each = ids.map((id) => {
    const part = parts[id];
    const name = erps.find((entry) => entry.id === id)?.name ?? id;
    return `${name} ${part.erpNumber ?? PART_WORDS[part.status] ?? part.status}`;
  });
  return ids.length > 1 ? `Split: ${each.join("; ")}` : each[0];
}
