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
 * @returns {Promise<Record<string, boolean>>}
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
    fields: SCHEMA.map(({ name, label, description, type }) => ({
      default: SETTING_DEFAULTS[name],
      description,
      label,
      name,
      type,
    })),
    scope,
    scopes,
    values: config.map(({ name, value, origin }) => ({ name, origin, value })),
  };
}

/**
 * Validate a save: known settings only, each true, false, or null (use the wider
 * scope's value).
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
    if (value !== null && typeof value !== "boolean") {
      return `${name} must be true, false or null`;
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
