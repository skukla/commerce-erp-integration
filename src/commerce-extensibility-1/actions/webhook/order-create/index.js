import AioLogger from "@adobe/aio-lib-core-logging";

import { erp } from "#lib/erp";
import {
  extOrderIdOperation,
  noop,
  operations,
  readPayload,
  toErpOrder,
  unwrapOrder,
} from "#lib/webhook";

const ERP_TIMEOUT_MS = 4000;

/**
 * observer.sales_order_place_before: create the sales order in the ERP and put its number on
 * the order as `ext_order_id`. Any failure answers success so the order still places.
 */
async function main(params) {
  const logger = AioLogger("webhook-order-create", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const order = unwrapOrder(readPayload(params));
    if (!order) {
      logger.warn("no order in the payload; letting placement continue");
      return noop();
    }
    const request = toErpOrder(order);
    if (!request.commerceOrderId || request.lines.length === 0) {
      logger.warn("order carries no id or no lines; not creating an ERP order");
      return noop();
    }
    const res = await erp.createOrder(params, request, ERP_TIMEOUT_MS);
    if (!(res.ok && res.data?.number)) {
      logger.warn(
        `ERP answered ${res.status}; order places without an ERP number`,
      );
      return noop();
    }
    logger.info(
      `order ${request.commerceIncrementId || request.commerceOrderId} → ERP ${res.data.number}`,
    );
    return operations([extOrderIdOperation(res.data.number)]);
  } catch (error) {
    logger.error(
      `order-create failed, letting placement continue: ${error.message}`,
    );
    return noop();
  }
}

export { main };
