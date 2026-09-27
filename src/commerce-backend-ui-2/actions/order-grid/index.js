import {
  errorGridResponse,
  okGridResponse,
  parseGridRequest,
} from "@adobe/aio-commerce-sdk/admin-ui/grid-columns";

import appConfig from "#app.commerce.config";
import { readRecord } from "#lib/history";
import { orderGridCell } from "#lib/order-grid";

/** The column's id, as this copy of the app declares it (a second ERP's copy has its own). */
const COLUMN_ID = appConfig.adminUi.order.gridColumns.columns[0].id;

/**
 * This ERP's column on Commerce's Sales > Orders grid (Admin UI SDK V2 order grid columns).
 * Commerce POSTs `{ requestId, gridType, ids }` with the visible orders' numbers; each order
 * this ERP knows gets its cell, the rest are left empty.
 *
 * @param {object} params the grid request, merged into the action params
 * @returns {Promise<object>} the grid response
 */
async function main(params) {
  try {
    const { ids } = parseGridRequest(params);
    const data = {};
    for (const id of ids) {
      // biome-ignore lint/performance/noAwaitInLoops: one small read per visible order
      const cell = orderGridCell(await readRecord(`order.${id}`));
      if (cell) {
        data[id] = { [COLUMN_ID]: cell };
      }
    }
    return okGridResponse(data);
  } catch (error) {
    return errorGridResponse(400, error.message);
  }
}

export { main };
