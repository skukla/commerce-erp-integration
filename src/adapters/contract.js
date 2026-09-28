/*
 * The contract every ERP adapter implements (design v1 §2, "Code layout"). The router knows
 * no ERP: it hands each ERP's part of an order to that ERP's adapter and reads the outcome
 * back in one vocabulary. An adapter knows exactly one kind of ERP and nothing of the others.
 *
 * To add an ERP of a new kind: write a folder under src/adapters/ that exports these two
 * functions, register it in src/lib/erps.js, and add the ERP to the ERP list. Nothing else in
 * the integration changes.
 */

/**
 * @typedef {object} ErpEntry One ERP in the list (src/lib/erps.js).
 * @property {string} id Unique and never changes; the key for parts, the key map and settings,
 *   and the value a product's owning-ERP attribute holds.
 * @property {string} name The label people read.
 * @property {string} adapter The kind of ERP: the adapter folder that talks to it.
 * @property {object} connection Where the adapter sends.
 */

/**
 * @typedef {object} Part One ERP's share of a Commerce order.
 * @property {ErpEntry} erp The ERP that owns these lines.
 * @property {object} order The Commerce order, as the order event carries it.
 * @property {object[]} lines The order's lines this ERP owns (every line while there is one ERP).
 */

/**
 * @typedef {object} PartOutcome What happened to a part, in the vocabulary order-sync uses.
 * @property {"sent"|"skipped"|"held"|"dropped"|"failed"} outcome
 * @property {number} statusCode The answer the event action gives I/O Events.
 * @property {string} message One sentence for the history and the logs.
 * @property {string} [erpNumber] The ERP's own order number, once it has one.
 */

/**
 * @callback SendPart Send one part to the ERP and write back what Commerce needs.
 * @param {object} params action params (credentials, settings)
 * @param {Part} part the part to send
 * @param {object} deps the Commerce, ERP and settings collaborators (lib/order-deps.js)
 * @returns {Promise<PartOutcome>}
 */

/**
 * @callback ReadOutcome Turn one of this ERP's inbound messages into a part outcome, or null
 *   when the message is not about a part.
 * @param {object} event the ERP's message
 * @returns {PartOutcome|null}
 */

/** The functions an adapter must export. */
export const ADAPTER_FUNCTIONS = Object.freeze(["sendPart", "readOutcome"]);

/**
 * Check that an adapter implements the contract.
 * @param {object} adapter an adapter module
 * @param {string} [kind] its name, for the error
 * @returns {object} the adapter
 * @throws {Error} naming the first missing function
 */
export function assertAdapter(adapter, kind = "adapter") {
  for (const name of ADAPTER_FUNCTIONS) {
    if (typeof adapter?.[name] !== "function") {
      throw new Error(`${kind} does not implement ${name}`);
    }
  }
  return adapter;
}
