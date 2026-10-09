/*
 * Per-ERP settings (design v1 §2, slice B3b). Settings that differ per ERP live on that ERP's
 * entry in the ERP list (lib/erps.js), edited through `erp/erps`: which products it owns, its
 * order-number prefix, and its sales organization, per website if need be. Settings for the
 * whole integration (send orders, hold when offline, the confirm status, contract prices,
 * the discount ceiling) stay in App Management's configuration (lib/settings.js). An entry's
 * value wins; anything it does not set is the integration's configured value, so an install
 * with one ERP and no entry settings behaves exactly as before.
 *
 * Shape on an entry: `settings: { <per-ERP key>: value, websites: { <code>: { structure_sales_org,
 * structure_sales_org_name } } }`.
 */
import { OWNS } from "#lib/structure";

/** The settings an ERP entry may set, in the order the Admin page shows them. */
export const PER_ERP_KEYS = Object.freeze([
  "structure_owns",
  "structure_owns_attribute",
  "structure_owns_websites",
  "structure_order_prefix",
  "structure_sales_org",
  "structure_sales_org_name",
]);

/** The per-ERP settings that may differ per website. */
export const WEBSITE_KEYS = Object.freeze([
  "structure_sales_org",
  "structure_sales_org_name",
]);

const WEBSITE_CODE = /^[a-z][a-z0-9_]*$/u;
const OWNS_MODES = new Set(Object.values(OWNS));

function pick(values, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => values?.[key] !== undefined && values[key] !== null)
      .map((key) => [key, values[key]]),
  );
}

/**
 * The settings one ERP works with: the integration's, the entry's own on top, and the
 * entry's values for the website on top of those.
 * @param {object} base the integration's settings (lib/settings.js)
 * @param {object} entry the ERP list entry
 * @param {string} [websiteCode] the website the order or cart is on
 * @returns {object}
 */
export function withErpSettings(base, entry, websiteCode) {
  const own = entry?.settings ?? {};
  return {
    ...base,
    ...pick(own, PER_ERP_KEYS),
    ...(websiteCode ? pick(own.websites?.[websiteCode], WEBSITE_KEYS) : {}),
  };
}

function valueProblem(key, value) {
  if (typeof value !== "string") {
    return `${key} must be text`;
  }
  if (key === "structure_owns" && !OWNS_MODES.has(value)) {
    return `structure_owns must be one of ${[...OWNS_MODES].join(", ")}`;
  }
  return null;
}

function valuesProblem(values, keys, where) {
  for (const [key, value] of Object.entries(values ?? {})) {
    if (!keys.includes(key)) {
      return `${key} cannot be set ${where}`;
    }
    const problem = valueProblem(key, value);
    if (problem) {
      return problem;
    }
  }
  return null;
}

/**
 * @param {unknown} settings an entry's settings as sent
 * @returns {string|null} the first problem, or null
 */
export function erpSettingsProblem(settings) {
  if (settings === undefined) {
    return null;
  }
  if (typeof settings !== "object" || settings === null) {
    return "settings is an object of per-ERP settings";
  }
  const { websites, ...own } = settings;
  const problem = valuesProblem(own, PER_ERP_KEYS, "on an ERP");
  if (problem) {
    return problem;
  }
  for (const [code, values] of Object.entries(websites ?? {})) {
    if (!WEBSITE_CODE.test(code)) {
      return `website ${code} is not a website code`;
    }
    const inWebsite = valuesProblem(values, WEBSITE_KEYS, "per website");
    if (inWebsite) {
      return inWebsite;
    }
  }
  return null;
}

function applied(values, changes) {
  const next = { ...values };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

/**
 * An entry's settings after a save from the Admin page: at the ERP's defaults, or at one
 * website. `null` removes a value, so the wider value (the ERP's, then the integration's)
 * applies again. Empty website blocks are dropped.
 * @param {object} settings the entry's settings now
 * @param {string} [websiteCode] the website being edited; the ERP's defaults when omitted
 * @param {object} changes `{ <key>: value | null }`
 * @returns {object} the new settings
 */
export function applyErpSettingChanges(settings, websiteCode, changes) {
  const { websites = {}, ...own } = settings ?? {};
  const nextOwn = websiteCode ? own : applied(own, changes);
  const nextWebsites = { ...websites };
  if (websiteCode) {
    nextWebsites[websiteCode] = applied(websites[websiteCode], changes);
  }
  for (const [code, values] of Object.entries(nextWebsites)) {
    if (Object.keys(values).length === 0) {
      delete nextWebsites[code];
    }
  }
  return Object.keys(nextWebsites).length > 0
    ? { ...nextOwn, websites: nextWebsites }
    : nextOwn;
}
