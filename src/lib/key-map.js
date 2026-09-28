/*
 * The key map: which Commerce record is which ERP record. Data this integration keeps, never
 * typed in by anyone and never known to the ERP (owner, 2026-09-25: the ERP runs as if it had
 * always been the source). Demo Builder loads it whole after each fill, the way a key map is
 * loaded at a real go-live; the integration adds a row when it creates an ERP customer itself.
 *
 * Customers only: products pair by SKU, which is the ERP's material number here.
 *
 * Several ERPs (slice B3a): a company buying from two brands is a customer in each brand's
 * ERP, so a pair belongs to one ERP (`erpId`, the ERP list's id) and a company pairs once per
 * ERP. `erp` stays the ERP's customer number. An entry without `erpId` is the single ERP
 * "erp", which is how every map stored before several ERPs reads; such entries are kept
 * without the field, so a single-ERP map is stored exactly as before.
 *
 * Kept in App Builder State under one key, like the write ledger (lib/ledger.js).
 */
import stateLib from "@adobe/aio-lib-state";

import { SINGLE_ERP_ID } from "#lib/erps";

const KEY = "erp-key-map";
const TTL_SECONDS = 365 * 24 * 60 * 60;
const KINDS = new Set(["customer"]);
const COMMERCE_ID = /^\d+$/u;
const MAX_ENTRIES = 5000;
const ERP_ID = /^[a-z][a-z0-9-]{0,62}$/u;

/** The ERP an entry belongs to. */
const erpOf = (entry) => entry.erpId ?? SINGLE_ERP_ID;

/** An entry as stored: `erpId` only when it is not the single ERP. */
function stored(commerce, erp, erpId) {
  return erpId && erpId !== SINGLE_ERP_ID
    ? { commerce, erp, erpId, kind: "customer" }
    : { commerce, erp, kind: "customer" };
}

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetKeyMapClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

/** @returns {Promise<Array<{kind: string, commerce: string, erp: string}>>} */
export async function readKeyMap() {
  const res = await (await state()).get(KEY);
  if (!res?.value) {
    return [];
  }
  try {
    return JSON.parse(res.value);
  } catch {
    return [];
  }
}

async function writeKeyMap(entries) {
  await (await state()).put(KEY, JSON.stringify(entries), { ttl: TTL_SECONDS });
}

/** What is wrong with a map, in words, or null when nothing is. */
function entryProblem(entry, index) {
  if (!KINDS.has(entry?.kind)) {
    return `entry ${index}: kind must be one of ${[...KINDS].join(", ")}`;
  }
  if (!COMMERCE_ID.test(String(entry.commerce ?? ""))) {
    return `entry ${index}: commerce must be a Commerce id (digits)`;
  }
  if (typeof entry.erp !== "string" || entry.erp.trim() === "") {
    return `entry ${index}: erp must be the ERP's number`;
  }
  if (entry.erpId !== undefined && !ERP_ID.test(String(entry.erpId))) {
    return `entry ${index}: erpId must be the ERP list's id (lower-case letters, digits, hyphens)`;
  }
  return null;
}

function duplicateProblem(entries) {
  for (const side of ["commerce", "erp"]) {
    const seen = new Set();
    for (const entry of entries) {
      const key = `${entry.kind}|${erpOf(entry)}|${entry[side]}`;
      if (seen.has(key)) {
        return `${side} ${entry[side]} is paired twice in ERP ${erpOf(entry)}`;
      }
      seen.add(key);
    }
  }
  return null;
}

/**
 * @param {unknown} entries a map as sent
 * @returns {string|null} the first problem, or null
 */
export function keyMapProblem(entries) {
  if (!Array.isArray(entries)) {
    return "entries is a list of { kind, commerce, erp }";
  }
  if (entries.length > MAX_ENTRIES) {
    return `entries holds at most ${MAX_ENTRIES} rows`;
  }
  for (const [index, entry] of entries.entries()) {
    const problem = entryProblem(entry, index);
    if (problem) {
      return problem;
    }
  }
  return duplicateProblem(entries);
}

/** Replace the whole map (Demo Builder, after a fill). Check it with keyMapProblem first. */
export async function replaceKeyMap(entries) {
  await writeKeyMap(
    entries.map((e) => stored(String(e.commerce), e.erp, e.erpId)),
  );
}

/**
 * Pair one Commerce company with the customer an ERP created for it, replacing that ERP's old
 * pair; other ERPs' pairs are left alone.
 */
export async function pairCustomer(
  commerceId,
  erpNumber,
  erpId = SINGLE_ERP_ID,
) {
  const commerce = String(commerceId);
  const rest = (await readKeyMap()).filter(
    (e) =>
      !(
        e.kind === "customer" &&
        erpOf(e) === erpId &&
        (e.commerce === commerce || e.erp === erpNumber)
      ),
  );
  await writeKeyMap([...rest, stored(commerce, erpNumber, erpId)]);
}

/** One ERP's customer number for a Commerce company, or null. */
export async function erpCustomerOf(commerceId, erpId = SINGLE_ERP_ID) {
  const commerce = String(commerceId);
  const row = (await readKeyMap()).find(
    (e) =>
      e.kind === "customer" && erpOf(e) === erpId && e.commerce === commerce,
  );
  return row?.erp ?? null;
}

/** The Commerce company id for one ERP's customer number, or null. */
export async function commerceCompanyOf(erpNumber, erpId = SINGLE_ERP_ID) {
  const row = (await readKeyMap()).find(
    (e) => e.kind === "customer" && erpOf(e) === erpId && e.erp === erpNumber,
  );
  return row?.commerce ?? null;
}

/**
 * The Commerce company an ERP customer event is about: the key map's pair for the ERP's own
 * number in the ERP that sent it (`erpId`, contract version 4; an event without it is the
 * single ERP's), else null. The ERP's events carry no Commerce id (contract version 3).
 * @param {{ partnerId?: string, erpId?: string }} data the event's data
 */
export async function companyOfErpEvent(data = {}) {
  const mapped = data.partnerId
    ? await commerceCompanyOf(data.partnerId, data.erpId ?? SINGLE_ERP_ID)
    : null;
  return mapped ?? null;
}
