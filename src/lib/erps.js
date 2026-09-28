/*
 * The ERP list (design v1 §2): one entry per ERP this integration serves, keyed by an id that
 * never changes. The name is only a label; nothing routes by it.
 *
 * Where the list comes from (slice B3a): Demo Builder stores it in App Builder State when an
 * SC adds or removes an ERP (the `erp/erps` action). With nothing stored, the list is one
 * entry built from the settings the integration deploys with (ERP_BASE_URL,
 * ERP_DISPLAY_NAME), id "erp": an install with one ERP keeps working exactly as before.
 *
 * State is read only on Runtime (or through the test seam): a local run with neither has
 * nothing stored. On Runtime a failed read is an error, never "nothing stored", because
 * falling back to one ERP would send every line of a split order to that ERP.
 */
import stateLib from "@adobe/aio-lib-state";

import { assertAdapter } from "#adapters/contract";
import * as demoErp from "#adapters/demo-erp/index";
import { authToKeep, erpAuthProblem } from "#lib/erp-auth";
import { applyErpSettingChanges, erpSettingsProblem } from "#lib/erp-settings";

/** The adapter for each kind of ERP. A new kind is one line here. */
const ADAPTERS = Object.freeze({
  "demo-erp": demoErp,
});

/** The id of the single ERP an install has before several ERPs are listed. */
export const SINGLE_ERP_ID = "erp";

/**
 * @param {object} params action params
 * @returns {import("#adapters/contract").ErpEntry[]}
 */
export function listErps(params = {}) {
  return [
    {
      adapter: "demo-erp",
      connection: { baseUrl: params.ERP_BASE_URL ?? null },
      id: SINGLE_ERP_ID,
      name: params.ERP_DISPLAY_NAME || "the ERP",
    },
  ];
}

/**
 * @param {import("#adapters/contract").ErpEntry[]} erps the list
 * @param {string} id an ERP id
 * @returns {import("#adapters/contract").ErpEntry|null}
 */
export function erpById(erps, id) {
  return erps.find((entry) => entry.id === id) ?? null;
}

/**
 * Which ERP an ERP event came from. With one ERP, that one. With several, the ERP the event
 * names; an event naming none is the first ERP's (`erp`) while it is listed, since a first ERP
 * deployed before events carried an id sends none. Otherwise null: it cannot be attributed.
 * @param {import("#adapters/contract").ErpEntry[]} erps the list
 * @param {string} [erpId] the id the event names
 * @returns {string|null}
 */
export function eventErpId(erps, erpId) {
  if (erps.length === 1) {
    return erps[0].id;
  }
  if (erpId) {
    return erpId;
  }
  return erpById(erps, SINGLE_ERP_ID) ? SINGLE_ERP_ID : null;
}

/**
 * The adapter that talks to an ERP.
 * @param {import("#adapters/contract").ErpEntry} entry the ERP
 * @returns {object} the adapter
 * @throws {Error} when no adapter handles that kind of ERP
 */
export function adapterFor(entry) {
  const adapter = ADAPTERS[entry?.adapter];
  if (!adapter) {
    throw new Error(`No adapter "${entry?.adapter}" for ERP ${entry?.id}.`);
  }
  return assertAdapter(adapter, entry.adapter);
}

const KEY = "erp-list";
const TTL_SECONDS = 365 * 24 * 60 * 60;
const MAX_ERPS = 50;
const ID = /^[a-z][a-z0-9-]{0,62}$/u;
const HTTPS = /^https:\/\/\S+$/u;

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetErpsClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

/** Whether a stored list can exist here: on Runtime, or with a client handed in. */
function stateAvailable() {
  return Boolean(statePromise) || Boolean(process.env.__OW_NAMESPACE);
}

/** @returns {Promise<import("#adapters/contract").ErpEntry[]>} the stored list, or [] */
export async function readStoredErps() {
  if (!stateAvailable()) {
    return [];
  }
  const res = await (await state()).get(KEY);
  if (!res?.value) {
    return [];
  }
  const entries = JSON.parse(res.value);
  return Array.isArray(entries) ? entries : [];
}

/**
 * The ERP list this integration serves: the stored list, else today's single ERP.
 * @param {object} params action params
 * @returns {Promise<import("#adapters/contract").ErpEntry[]>}
 */
export async function loadErps(params = {}) {
  const stored = await readStoredErps();
  return stored.length > 0 ? stored : listErps(params);
}

function entryProblem(entry, index) {
  if (!ID.test(String(entry?.id ?? ""))) {
    return `entry ${index}: id must be lower-case letters, digits and hyphens, starting with a letter`;
  }
  if (typeof entry.name !== "string" || entry.name.trim() === "") {
    return `entry ${index}: name must be the ERP's name`;
  }
  if (!ADAPTERS[entry.adapter]) {
    return `entry ${index}: adapter must be one of ${Object.keys(ADAPTERS).join(", ")}`;
  }
  if (!HTTPS.test(String(entry.connection?.baseUrl ?? ""))) {
    return `entry ${index}: connection.baseUrl must be the ERP's https address`;
  }
  const auth = erpAuthProblem(entry.connection.auth);
  if (auth) {
    return `entry ${index}: ${auth}`;
  }
  const settings = erpSettingsProblem(entry.settings);
  return settings ? `entry ${index}: ${settings}` : null;
}

function duplicateProblem(entries) {
  const ids = new Set();
  const names = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      return `id ${entry.id} is used twice`;
    }
    const name = entry.name.trim().toLowerCase();
    if (names.has(name)) {
      return `name ${entry.name.trim()} is used twice`;
    }
    ids.add(entry.id);
    names.add(name);
  }
  return null;
}

/**
 * @param {unknown} entries a list as sent
 * @returns {string|null} the first problem, or null
 */
export function erpsProblem(entries) {
  if (!Array.isArray(entries)) {
    return "entries is a list of { id, name, adapter, connection }";
  }
  if (entries.length === 0) {
    return "entries holds at least one ERP";
  }
  if (entries.length > MAX_ERPS) {
    return `entries holds at most ${MAX_ERPS} ERPs`;
  }
  for (const [index, entry] of entries.entries()) {
    const problem = entryProblem(entry, index);
    if (problem) {
      return problem;
    }
  }
  return duplicateProblem(entries);
}

/**
 * Replace the whole list (Demo Builder). Check it with erpsProblem first. An entry sent without
 * `connection.auth` keeps the credential stored under its id; `auth: null` clears it
 * (lib/erp-auth.js). An ERP left out of the list loses its credential with its entry.
 */
export async function replaceErps(entries) {
  const stored = await readStoredErps();
  const clean = entries.map((e) => ({
    adapter: e.adapter,
    connection: connectionToStore(e, stored),
    id: e.id,
    name: e.name.trim(),
    ...(e.settings && Object.keys(e.settings).length > 0
      ? { settings: e.settings }
      : {}),
  }));
  await (await state()).put(KEY, JSON.stringify(clean), { ttl: TTL_SECONDS });
}

function connectionToStore(entry, stored) {
  const auth = authToKeep(entry, stored);
  return auth
    ? { auth, baseUrl: entry.connection.baseUrl }
    : { baseUrl: entry.connection.baseUrl };
}

/**
 * Save one ERP's own settings (the Admin page), at its defaults or at one website. Only a
 * stored list has entries to save on: the single ERP of an unstored install takes its
 * settings from the integration's configuration.
 * @param {string} id the ERP
 * @param {string|undefined} websiteCode the website, or the ERP's defaults
 * @param {object} changes `{ <per-ERP key>: value | null }`
 * @returns {Promise<{ entry?: object, problem?: string }>}
 */
export async function updateErpSettings(id, websiteCode, changes) {
  const stored = await readStoredErps();
  if (stored.length === 0) {
    return {
      problem:
        "no ERP list is stored; one ERP takes its settings from the integration's configuration",
    };
  }
  const index = stored.findIndex((e) => e.id === id);
  if (index < 0) {
    return { problem: `no ERP ${id} in the list` };
  }
  const settings = applyErpSettingChanges(
    stored[index].settings,
    websiteCode,
    changes,
  );
  const problem = erpSettingsProblem(settings);
  if (problem) {
    return { problem };
  }
  const { settings: _old, ...rest } = stored[index];
  const entry = Object.keys(settings).length > 0 ? { ...rest, settings } : rest;
  const next = stored.map((e, i) => (i === index ? entry : e));
  await replaceErps(next);
  return { entry };
}
