/*
 * The merchant's integration settings (app.commerce.config.ts `businessConfig`), kept
 * per scope by @adobe/aio-commerce-lib-config: Default Config, then each website, store
 * and store view, a narrower scope overriding a wider one.
 *
 * Checkout reads them on every cart and order, and Commerce gives those webhooks about a
 * second, so a read is kept in the container for a minute and a read that fails answers
 * the declared defaults: a setting can never stop a checkout.
 */
import { getCommerceInstance } from "@adobe/aio-commerce-lib-app";
import {
  byCodeAndLevel,
  byScopeId,
  byStoreViewId,
  getConfiguration,
  getScopeTree,
  initialize,
  setConfiguration,
  syncCommerceScopes,
} from "@adobe/aio-commerce-lib-config";
import { resolveImsAuthParams } from "@adobe/aio-commerce-sdk/auth";

import appConfig from "#app.commerce.config";

const SCHEMA = appConfig.businessConfig.schema;

/** Each setting's declared default, by name. */
export const SETTING_DEFAULTS = Object.freeze(
  Object.fromEntries(SCHEMA.map((field) => [field.name, field.default])),
);

/** Each setting's declared type, by name. */
const SETTING_TYPES = Object.freeze(
  Object.fromEntries(SCHEMA.map((field) => [field.name, field.type])),
);

/** The values a list setting may take, by name. */
const LIST_VALUES = Object.freeze(
  Object.fromEntries(
    SCHEMA.filter((field) => field.type === "list").map((field) => [
      field.name,
      field.options.map((option) => option.value),
    ]),
  ),
);

/**
 * What a text setting must look like, and the words when it does not (business-structure
 * plan, step 02). A blank is allowed where the setting has a fallback.
 */
export const TEXT_RULES = Object.freeze({
  orders_confirm_status: {
    pattern: /^[a-z][a-z0-9_]*$/u,
    words:
      "a status code as created at Stores → Settings → Order Status, like erp_confirmed, or blank for a note only",
  },
  structure_order_prefix: {
    pattern: /^[A-Z0-9]{1,6}$/u,
    words:
      "one to six upper-case letters or digits, like ACME, or blank to derive it from the ERP's name",
  },
  structure_owns_attribute: {
    pattern: /^[a-z0-9_]+=[^=\s]+$/u,
    words: "an attribute code and a value, as erp_owner=ACME, or blank",
  },
  structure_owns_sources: {
    pattern: /^[a-z0-9_-]+(,\s*[a-z0-9_-]+)*$/u,
    words:
      "comma-separated inventory source codes, like default, east, or blank",
  },
  structure_sales_org: {
    blankAllowed: false,
    pattern: /^[A-Z0-9]{4}$/u,
    words: "exactly four upper-case letters or digits, like 1000 or EU01",
  },
});

/** Why one value is wrong for its setting, or null. */
function valueProblem(name, value) {
  const type = SETTING_TYPES[name];
  if (type === "boolean") {
    return typeof value === "boolean"
      ? null
      : `${name} must be true, false or null`;
  }
  if (typeof value !== "string") {
    return `${name} must be text or null`;
  }
  if (type === "list") {
    return LIST_VALUES[name].includes(value)
      ? null
      : `${name} must be one of ${LIST_VALUES[name].join(", ")}`;
  }
  const rule = TEXT_RULES[name];
  if (!rule) {
    return null;
  }
  if (value === "") {
    return rule.blankAllowed === false ? `${name} must be ${rule.words}` : null;
  }
  return rule.pattern.test(value) ? null : `${name} must be ${rule.words}`;
}

const CACHE_MS = 60_000;
const DEFAULT_SCOPE = byCodeAndLevel("global", "global");
const cache = new Map();

/** Forget cached reads (after a save in this container, and between tests). */
export function clearSettingsCache() {
  cache.clear();
}

function ready() {
  initialize({ schema: SCHEMA });
}

function valuesOf(config) {
  return Object.fromEntries(config.map((entry) => [entry.name, entry.value]));
}

async function readScope(selector) {
  const { config } = await getConfiguration(selector);
  return { ...SETTING_DEFAULTS, ...valuesOf(config) };
}

/**
 * The settings that apply to a store view, falling back to Default Config when the
 * store view is unknown, and to the declared defaults when nothing can be read.
 * Never throws.
 * @param {number|string|null|undefined} storeViewId Commerce's numeric store view id
 * @param {{ warn: Function }} [logger]
 * @returns {Promise<Record<string, boolean|string>>}
 */
export async function settingsFor(storeViewId, logger) {
  const id = Number(storeViewId);
  const key = Number.isInteger(id) && id > 0 ? id : "default";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return hit.values;
  }
  const selectors =
    key === "default" ? [DEFAULT_SCOPE] : [byStoreViewId(key), DEFAULT_SCOPE];
  let values = { ...SETTING_DEFAULTS };
  try {
    ready();
    values = await readFirst(selectors);
  } catch (error) {
    logger?.warn(`settings unreadable, using defaults: ${error.message}`);
  }
  cache.set(key, { at: Date.now(), values });
  return values;
}

/**
 * The settings at one website's scope, with Default Config beneath it: what an order
 * from that website carries as its sales organisation (business structure). Never
 * throws; unreadable answers the declared defaults.
 * @param {string} websiteCode the website's code
 */
export async function websiteSettings(websiteCode, logger) {
  let values = { ...SETTING_DEFAULTS };
  try {
    ready();
    values = await readFirst([
      byCodeAndLevel(websiteCode, "website"),
      DEFAULT_SCOPE,
    ]);
  } catch (error) {
    logger?.warn(
      `settings for website ${websiteCode} unreadable, using defaults: ${error.message}`,
    );
  }
  return values;
}

async function readFirst([selector, ...rest]) {
  try {
    return await readScope(selector);
  } catch (error) {
    if (rest.length === 0) {
      throw error;
    }
    return readFirst(rest);
  }
}

/** The Commerce client parameters the library needs to read websites and stores. */
async function commerceParams(params) {
  const instance = await getCommerceInstance();
  return {
    auth: resolveImsAuthParams(params),
    config: { baseUrl: instance.baseUrl, flavor: instance.env },
  };
}

const hasCommerceScopes = (tree) =>
  tree.some((node) => node.level !== "global");

/**
 * The scopes a merchant can pick, read from Commerce the first time (or when asked).
 * @returns {Promise<object[]>} the scope tree: Default Config, then Commerce's websites,
 *   stores and store views
 */
export async function settingScopes(params, { refresh = false } = {}) {
  ready();
  const { scopeTree } = await getScopeTree();
  if (!refresh && hasCommerceScopes(scopeTree)) {
    return scopeTree;
  }
  const synced = await syncCommerceScopes(await commerceParams(params));
  if (synced.error) {
    throw new Error(`Commerce's websites could not be read: ${synced.error}`);
  }
  return synced.scopeTree;
}

const selectorFor = (scopeId) => (scopeId ? byScopeId(scopeId) : DEFAULT_SCOPE);

/**
 * What the settings page shows for one scope: the fields, and each value with the scope
 * it comes from.
 * @param {string} [scopeId] a scope tree id; Default Config when omitted
 */
export async function settingsPage(params, scopeId) {
  const scopes = await settingScopes(params);
  const { scope, config } = await getConfiguration(selectorFor(scopeId));
  return {
    fields: SCHEMA.map(({ name, label, description, type, options }) => ({
      default: SETTING_DEFAULTS[name],
      description,
      label,
      name,
      ...(options ? { options } : {}),
      type,
    })),
    scope,
    scopes,
    values: config.map(({ name, value, origin }) => ({ name, origin, value })),
  };
}

/**
 * Validate a save: known settings only, each a value its type allows, or null (use the
 * wider scope's value).
 * @returns {string|null} what is wrong, or null
 */
export function saveProblem(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return "values must be an object of setting names";
  }
  const names = Object.keys(changes);
  if (names.length === 0) {
    return "nothing to save";
  }
  for (const name of names) {
    if (!(name in SETTING_DEFAULTS)) {
      return `${name} is not a setting`;
    }
    const value = changes[name];
    if (value === null) {
      continue;
    }
    const problem = valueProblem(name, value);
    if (problem) {
      return problem;
    }
  }
  return null;
}

/** Save changes at a scope. A null value removes the override there. */
export async function saveSettings(scopeId, changes) {
  ready();
  const config = Object.entries(changes).map(([name, value]) => ({
    name,
    value,
  }));
  await setConfiguration({ config }, selectorFor(scopeId));
  clearSettingsCache();
}
