import {
  errorGridResponse,
  okGridResponse,
  parseGridRequest,
} from "@adobe/aio-commerce-sdk/admin-ui/grid-columns";

import appConfig from "#app.commerce.config";
import { loadErps } from "#lib/erps";
import { readRecord } from "#lib/history";
import { orderGridCell, partsNumbersCell } from "#lib/order-grid";
import { readOrderParts } from "#lib/order-parts";
import { partsSummary } from "#lib/order-parts-view";

/** The columns' ids, as this copy of the app declares them (a second ERP's copy has its own). */
const [COLUMN_ID, PARTS_COLUMN_ID] =
  appConfig.adminUi.order.gridColumns.columns.map((column) => column.id);

/**
 * The ERP list when there are several, else null. A list that cannot be read costs only the
 * names: each order keeps the cell its history record gives.
 */
async function severalErps(params) {
  const erps = await loadErps(params).catch(() => []);
  return erps.length > 1 ? erps : null;
}

/**
 * This ERP's columns on Commerce's Sales > Orders grid (Admin UI SDK V2 order grid columns).
 * Commerce POSTs `{ requestId, gridType, ids }` with the visible orders' numbers; each order
 * this ERP knows gets its cell (with several ERPs, each part's ERP and number when the order
 * has parts: a split order has no single ERP number), each order the router split into parts gets its "ERP parts"
 * cell (lib/order-parts-view.js), and the rest are left empty.
 *
 * @param {object} params the grid request, merged into the action params
 * @returns {Promise<object>} the grid response
 */
async function main(params) {
  try {
    const { ids } = parseGridRequest(params);
    const erps = await severalErps(params);
    const data = {};
    for (const id of ids) {
      // biome-ignore lint/performance/noAwaitInLoops: two small reads per visible order
      const record = await readOrderParts(id).catch(() => undefined);
      const cell =
        (erps && partsNumbersCell(record, erps)) ??
        orderGridCell(await readRecord(`order.${id}`));
      const parts = record ? partsSummary(record) : undefined;
      const row = {
        ...(cell ? { [COLUMN_ID]: cell } : {}),
        ...(parts ? { [PARTS_COLUMN_ID]: parts } : {}),
      };
      if (Object.keys(row).length > 0) {
        data[id] = row;
      }
    }
    return okGridResponse(data);
  } catch (error) {
    return errorGridResponse(400, error.message);
  }
}

export { main };
