/*
 * A skeleton adapter, to show what adding a new kind of ERP takes.
 *
 * To add an ERP, write a folder that does these two things, and add one line to the ERP
 * list:
 *
 *   1. Copy this folder to src/adapters/<your-erp-kind>/.
 *   2. sendPart: turn the part's lines into your ERP's sales-order request, send it, and
 *      answer the outcome. Keep it idempotent on the Commerce order and part, because the
 *      router may send the same part again after a failure.
 *   3. readOutcome: turn your ERP's messages (accepted, held, shipped, invoiced, cancelled)
 *      into a part outcome, so the router can write the combined order status.
 *   4. Register the kind in src/lib/erps.js (ADAPTERS) and add the ERP to the list.
 *
 * The router, the storefront, the checkout and the other ERPs' adapters do not change.
 * This file is not registered: it is documentation that the contract test runs.
 */

/**
 * @type {import("../contract.js").SendPart}
 */
export function sendPart(_params, part) {
  // Map part.lines to your ERP's order lines, call its API at part.erp.connection, and answer
  // e.g. { outcome: "sent", statusCode: 200, message: "...", erpNumber: "SO-4711" }.
  throw new Error(
    `The example adapter sends nothing: implement sendPart for ${part?.erp?.id ?? "your ERP"}.`,
  );
}

/**
 * @type {import("../contract.js").ReadOutcome}
 */
export function readOutcome(_event) {
  // Recognise your ERP's message and answer a part outcome, or null if it is not about one.
  return null;
}
