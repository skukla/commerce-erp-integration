/*
 * A product made or saved in Commerce, as its Activity record says it (lib/history.js
 * recordProductChange): what the ERP was told, or why it was not. Shared by the created and
 * updated actions.
 */

/** What a new product sends the ERP (created/transformer.js). */
export const CREATE_SENDS = Object.freeze(["name", "price"]);

/**
 * What a save sends, whatever changed: its name and price (updated/transformer.js) and its
 * stock (updated/sender.js). Commerce's event does not say which attribute changed.
 */
export const SAVE_SENDS = Object.freeze(["name", "price", "stock"]);

/**
 * @param {{ sku: string, name: string }} row the product as sent
 * @param {object} result sendData's answer
 * @param {readonly string[]} sent what the ERP is told
 * @returns {{ message: string, outcome: string, sent?: string[], erpIds?: string[] }}
 */
export function activityOf(row, result, sent) {
  const product = `Product ${row.sku}`;
  if (!result.success) {
    return {
      message: `${product}: not sent to the ERP: ${result.message}`,
      outcome: "failed",
    };
  }
  const to = result.erp?.name ?? "the ERP";
  const rest = sent.includes("stock") ? ", price and stock" : " and price";
  return {
    message: `${product}: told ${to} its name ("${row.name}")${rest}.`,
    outcome: "sent",
    sent: [...sent],
    ...(result.erp ? { erpIds: [result.erp.id] } : {}),
  };
}
