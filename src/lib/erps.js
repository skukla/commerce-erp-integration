/*
 * The ERP list (design v1 §2): one entry per ERP this integration serves, keyed by an id that
 * never changes. The name is only a label; nothing routes by it.
 *
 * Phase B slice B0 has one entry, built from the settings the integration already deploys
 * with (ERP_BASE_URL, ERP_DISPLAY_NAME). Its id is "erp": the one ERP of a single-ERP
 * install needs no other identity, and several ERPs arrive with ids of their own (slice B3).
 */

import { assertAdapter } from "#adapters/contract";
import * as demoErp from "#adapters/demo-erp/index";

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
