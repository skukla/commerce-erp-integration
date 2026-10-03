import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { checkoutInvoiceOf } from "#lib/checkout-invoice";
import { invoiceFromCommerce } from "#lib/commerce-changes";
import { erp } from "#lib/erp";
import { recordCommerceChange } from "#lib/history";
import { settingsFor } from "#lib/settings";
import { fulfilmentFromCommerce } from "#router/part-fulfilment";
import { getInvoice, getOrder } from "#src/order/commerce-order-api-client";

/**
 * observer.sales_order_invoice_save_after: an invoice made in Commerce invoices the ERP order,
 * with an origin marker so the ERP does not invoice it again (bidirectional review, item 1).
 * The invoice Commerce made at checkout, when a card was captured, is told to no ERP (AB-66).
 * A 503 answer asks I/O Events to deliver again later; a 400 ends the delivery.
 */
async function main(params) {
  const logger = AioLogger("order-commerce-invoiced", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const value = params.data?.value ?? params.data;
    // The invoice Commerce made at checkout is no ERP's (lib/checkout-invoice.js, AB-66); a
    // split order's other invoices reach each ERP with only its own lines (router/part-fulfilment.js).
    const result =
      (await checkoutInvoiceOf(params, value, { getInvoice, getOrder })) ??
      (await fulfilmentFromCommerce(params, "invoice", value)) ??
      (await invoiceFromCommerce(params, value, {
        erp,
        getOrder,
        settingsFor,
      }));
    logger.info(result.message);
    await recordCommerceChange("invoiced", value, result, { logger });
    if (result.outcome === "held") {
      return buildErrorResponse(result.statusCode, {
        body: { message: result.message },
      });
    }
    if (result.outcome === "dropped") {
      return badRequest(result.message);
    }
    return ok({ body: { message: result.message } });
  } catch (error) {
    logger.error(`invoiced event failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
