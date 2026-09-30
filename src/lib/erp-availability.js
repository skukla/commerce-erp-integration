/*
 * Available-to-promise, asked of ONE ERP (AB-19): can it promise these quantities, and by
 * when. The one call both askers share — the placement webhook (an early signal while the
 * shopper waits) and the router (the answer recorded on the order's part) — so the request
 * has one shape and one timeout.
 *
 * Never a reason to hold anything: every caller fails open. A shortfall ships later on the
 * promised date; an ERP that cannot answer leaves no promise.
 */
import { paramsForErp } from "#adapters/contract";
import { erpRequest } from "#lib/erp";

// Well inside Commerce's 10 s hard timeout on the placement hook (app.commerce.config.ts),
// where this runs beside the credit check; the router has no such clock but asks the same way.
export const AVAILABILITY_TIMEOUT_MS = 4000;

/** A line's ordered quantity, whichever field the payload carries. */
function qtyOf(line) {
  return Number(line.qty_ordered ?? line.qty) || 0;
}

/**
 * The SKU/qty lines an availability call asks about. A configurable's child line travels
 * with its parent and is not asked about on its own.
 * @param {object[]} lines order or cart lines
 * @returns {{ sku: string, qty: number }[]}
 */
export function askLines(lines) {
  return lines
    .filter((line) => !line.parent_item_id && line.sku)
    .map((line) => ({ qty: qtyOf(line), sku: line.sku }));
}

/**
 * POST products/availability on one ERP.
 * @param {object} params action inputs (the IMS credential)
 * @param {import("#adapters/contract").ErpEntry} erp the ERP to ask
 * @param {object[]} lines the part's lines
 * @param {number} [timeoutMs]
 * @returns {Promise<object[]>} one promise per asked line, as the ERP answers them
 *   (`{ sku, requested, availableNow, canPromiseNow, promiseDate, leadTimeDays }`, or
 *   `{ sku, unknown: true }` for a SKU it does not have — demo-erp lib/availability.js)
 * @throws on a network failure, a timeout, or a non-2xx answer — callers fail open
 */
export async function availabilityOf(
  params,
  erp,
  lines,
  timeoutMs = AVAILABILITY_TIMEOUT_MS,
) {
  const res = await erpRequest(paramsForErp(params, erp), "products", {
    body: { lines: askLines(lines) },
    method: "POST",
    path: "/availability",
    timeoutMs,
  });
  if (!res.ok) {
    throw new Error(`the ERP answered ${res.status}`);
  }
  return res.data.lines ?? [];
}
