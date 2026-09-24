/*
 * The seller side of the structure, as the integration carries it (business-structure
 * plan, step 02): which sales organisation an order belongs to, and the prefix that tells
 * one ERP's order numbers from another's on the same Commerce store.
 *
 * Multi-ERP rule M4 (owner, 2026-09-24): the number written onto a Commerce order is
 * `ACME-0000001042`. The prefix is added on the way out and stripped on the way in; the
 * ERP itself never sees it. Two ERPs both number from 0000001000, so the prefix is what
 * makes "is this order mine?" answerable before asking the ERP (rule M2).
 */

const PREFIX = /^[A-Z0-9]{1,6}$/u;
const EXT_ORDER_ID = /^(?:([A-Z0-9]{1,6})-)?(\d{10})$/u;
const FALLBACK_PREFIX = "ERP";
const DERIVED_LENGTH = 4;

/**
 * The prefix this pair puts on its order numbers: the setting, else the first letters
 * and digits of the ERP's name, upper-cased (`Acme ERP` → `ACME`), else `ERP`.
 * @param {object} [settings] the pair's settings (Default Config carries the prefix)
 * @param {object} [params] the action params (`ERP_DISPLAY_NAME`)
 */
export function orderPrefix(settings, params) {
  const set = settings?.structure_order_prefix;
  if (typeof set === "string" && PREFIX.test(set)) {
    return set;
  }
  const derived = String(params?.ERP_DISPLAY_NAME ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "")
    .slice(0, DERIVED_LENGTH);
  return derived || FALLBACK_PREFIX;
}

/** `ACME-0000001042` */
export const withPrefix = (number, prefix) => `${prefix}-${number}`;

/**
 * What a Commerce order's ext_order_id says: the prefix (null before prefixes existed)
 * and the ERP number (null when the field holds something that is not an ERP number).
 * @param {string|null|undefined} extOrderId
 * @returns {{ prefix: string|null, number: string|null }}
 */
export function splitExtOrderId(extOrderId) {
  const text = typeof extOrderId === "string" ? extOrderId.trim() : "";
  if (!text) {
    return { number: null, prefix: null };
  }
  const match = EXT_ORDER_ID.exec(text);
  if (!match) {
    return { number: null, prefix: null };
  }
  return { number: match[2], prefix: match[1] ?? null };
}

/**
 * The sales organisation an order from a website belongs to: the website's setting, else
 * `1000` (a store with one website and no setting is one sales organisation).
 * @param {object} [settings] the settings read for the order's store view
 * @returns {{ salesOrg: string, salesOrgName?: string }}
 */
export function salesOrgOf(settings) {
  const salesOrg =
    typeof settings?.structure_sales_org === "string" &&
    settings.structure_sales_org
      ? settings.structure_sales_org
      : "1000";
  const name = settings?.structure_sales_org_name;
  return typeof name === "string" && name
    ? { salesOrg, salesOrgName: name }
    : { salesOrg };
}
