/*
 * The Overview's one search box (components/overview-tab.jsx): what the text typed is taken to
 * be. A long number is an order (Commerce order numbers are nine or ten digits), a short one a
 * Commerce company id; anything else is looked up as a SKU, then as a part of a company's name.
 */

const HASH = /^#/u;
const ORDER_NUMBER = /^(?:0\d+|\d{7,})$/u;
const COMPANY_ID = /^(?:company\s+)?(\d{1,6})$/iu;

/**
 * @param {string} typed what was typed
 * @returns {null | { kind: "order", ref: string } | { kind: "company", id: string } |
 *   { kind: "text", text: string }}
 */
export function searchTarget(typed) {
  const text = String(typed ?? "").trim();
  if (!text) {
    return null;
  }
  const bare = text.replace(HASH, "");
  if (ORDER_NUMBER.test(bare)) {
    return { kind: "order", ref: bare };
  }
  const company = COMPANY_ID.exec(bare);
  if (company) {
    return { id: company[1], kind: "company" };
  }
  return { kind: "text", text };
}
