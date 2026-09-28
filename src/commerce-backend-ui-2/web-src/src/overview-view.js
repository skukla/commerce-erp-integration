/*
 * What the page says about each ERP with several ERPs, kept apart from the React that renders
 * it (as history-view.js is): the header's line per ERP, and the Overview's figures per ERP.
 * Each listed ERP comes from erp/status `erps`: its name, whether the integration can use it,
 * why not (`error`: a maintenance window, a refusal such as "the ERP answered 401", or a
 * network error), and its own figures.
 */

const NONE = "–";
const ENDED = /[.!?]$/u;

/** A reason as the end of a sentence: capitalised, with its full stop. */
function sentence(text) {
  const trimmed = String(text).trim();
  const ended = ENDED.test(trimmed) ? trimmed : `${trimmed}.`;
  return ended.charAt(0).toUpperCase() + ended.slice(1);
}

/** "Not reachable.", with the reason when the ERP gave one. */
function notReachable(entry) {
  return entry.error
    ? `not reachable. ${sentence(entry.error)}`
    : "not reachable.";
}

/**
 * The header's line for one ERP.
 * @param {{ name: string, reachable: boolean, error?: string }} entry one listed ERP
 * @returns {{ reachable: boolean, text: string }}
 */
export function erpStatusLine(entry) {
  return entry.reachable
    ? { reachable: true, text: `Connected to ${entry.name}` }
    : { reachable: false, text: `${entry.name} is ${notReachable(entry)}` };
}

/**
 * The Overview's rows, one per ERP, with a dash for a figure the ERP did not give.
 * @param {object[]} erps the listed ERPs (erp/status `erps`)
 * @param {(iso: string) => string} [when] how the page writes a time
 * @returns {object[]}
 */
export function overviewRows(erps, when = (iso) => iso) {
  return erps.map((entry) => {
    const counts = entry.counts ?? {};
    return {
      businessPartners: counts.businessPartners ?? NONE,
      events: counts.events ?? NONE,
      id: entry.id,
      lastImportAt: entry.lastImportAt ? when(entry.lastImportAt) : "never",
      lastWipeAt: entry.lastWipeAt ? when(entry.lastWipeAt) : "never",
      name: entry.name,
      products: counts.products ?? NONE,
      salesOrders: counts.salesOrders ?? NONE,
      state: entry.reachable ? "Reachable" : sentence(notReachable(entry)),
    };
  });
}
