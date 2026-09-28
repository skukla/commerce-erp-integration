import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { loadErps } from "#lib/erps";
import { readRecord } from "#lib/history";
import { readOrderParts } from "#lib/order-parts";
import { orderPartsPage } from "#lib/order-parts-view";
import { getOrder } from "#src/order/commerce-order-api-client";

/** Commerce order ids are whole numbers. */
const ORDER_ID = /^\d{1,12}$/u;

/**
 * The order view's "ERP parts" page (lib/order-parts-view.js).
 * GET ?orderId=<Commerce order id>, as the order view button hands it: the order's number,
 *   and each ERP's part of it with its lines, status, ERP number, why it waits, its setup
 *   warnings and whether staff may send it again. Read from the router's parts record, so
 *   it costs no call to an ERP.
 */
async function main(params) {
  const logger = AioLogger("erp-order-parts", {
    level: params.LOG_LEVEL || "info",
  });
  const orderId = String(params.orderId ?? "");
  if (!ORDER_ID.test(orderId)) {
    return badRequest("Name the order by its Commerce order id.");
  }
  try {
    const order = await getOrder(params, Number(orderId));
    const incrementId = String(order.increment_id);
    const [record, history, erps] = await Promise.all([
      readOrderParts(incrementId),
      readRecord(`order.${incrementId}`),
      loadErps(params),
    ]);
    return ok({
      body: {
        incrementId,
        orderId: Number(orderId),
        ...orderPartsPage({ erps, history, record }),
      },
    });
  } catch (error) {
    logger.error(`order-parts failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
