import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { recordingErpEvent } from "#lib/erp-event-history";
import { alreadyInvoicedWords, openToInvoice } from "#lib/invoiced-in-commerce";
import { stringParameters } from "#lib/utils";
import { invoicePart } from "#router/part-fulfilment";
import { handlePartMessage } from "#router/part-outcomes";
import {
  addComment,
  getOrder,
  invoiceOrder,
} from "#src/order/commerce-order-api-client";

const note = (comment) => ({
  statusHistory: { comment, is_customer_notified: 0, is_visible_on_front: 0 },
});

/**
 * be-observer.sales_order_invoice_create: invoice the Commerce order the ERP invoiced.
 *
 * With several ERPs the invoice is one ERP's part: Commerce gets a PARTIAL invoice of that
 * part's lines (router/part-fulfilment.js), never the whole order, which would bill the other
 * ERPs' lines; then the router records the part. Partial invoices on one order are created
 * one at a time; while another is being created the event answers 503 and is delivered again.
 *
 * Lines Commerce invoiced already are not invoiced again, which Commerce refuses: a card
 * captured at checkout invoices every line there (lib/invoiced-in-commerce.js). The ERP's
 * invoice is noted against the Commerce invoice that covers them and only the rest is
 * invoiced; with nothing left, nothing is, and the event still succeeds.
 */
async function handle(params) {
  const logger = AioLogger("order-external-invoice-created", {
    level: params.LOG_LEVEL || "info",
  });
  logger.info("Start processing request");
  logger.debug(`Received params: ${stringParameters(params)}`);
  const orderId = Number(params.data?.orderId ?? params.data?.id);
  if (!Number.isFinite(orderId)) {
    return badRequest("the event carries no orderId");
  }
  // With one ERP the whole order is invoiced below, whatever the lines: so an invoice that
  // names none is refused here, never read as "the whole order".
  const { items } = params.data;
  const lines = Array.isArray(items) ? items : Object.values(items ?? {});
  if (lines.length === 0) {
    return badRequest(
      `The ERP's invoice for order ${params.data.incrementId ?? orderId} names no lines; nothing was invoiced in Commerce.`,
    );
  }
  try {
    const partial = await invoicePart(params, orderId, params.data);
    if (partial?.busy) {
      return buildErrorResponse(503, { body: { message: partial.reason } });
    }
    if (partial && !partial.matched) {
      return badRequest(partial.reason);
    }
    const part = await handlePartMessage(
      params,
      "invoice",
      params.data,
      orderId,
    );
    if (part) {
      if (part.matched && partial?.before?.length > 0) {
        await notePartInvoicedBefore(params, orderId, partial);
      }
      return part.matched ? ok(part.message) : badRequest(part.reason);
    }
    return await invoiceWholeOrder(params, orderId, lines);
  } catch (error) {
    logger.error(`Error processing the request: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** A split order: say which of the part's lines Commerce had invoiced, and where. */
async function notePartInvoicedBefore(params, orderId, partial) {
  const order = await getOrder(params, orderId);
  const words = await alreadyInvoicedWords(
    params,
    order,
    partial.before,
    partial.invoiced.length === 0,
  );
  const number = params.data.invoiceNumber
    ? ` ${params.data.invoiceNumber}`
    : "";
  await addComment(
    params,
    orderId,
    note(`${partial.erpName}'s invoice${number}: ${words}.`),
  );
}

/** The ERP's own numbers for the order's history: its sales order, and its invoice if asked. */
function erpNumbers(data, withInvoice) {
  const named = [
    data.erpNumber ? `ERP sales order ${data.erpNumber}` : "",
    withInvoice && data.invoiceNumber ? `invoice ${data.invoiceNumber}` : "",
  ].filter(Boolean);
  return named.length > 0 ? ` (${named.join(", ")})` : "";
}

/**
 * One ERP: invoice the whole order (Commerce bills only what each line has left), unless
 * Commerce has nothing left of any line the ERP invoiced.
 */
async function invoiceWholeOrder(params, orderId, lines) {
  const order = await getOrder(params, orderId);
  const open = openToInvoice(order);
  const before = lines
    .map((line) => Number(line.orderItemId))
    .filter((id) => open.get(id) === 0)
    .map((id) => ({
      order_item_id: id,
      sku: order.items.find((item) => Number(item.item_id) === id)?.sku,
    }));
  const all = before.length === lines.length;
  if (!all) {
    await invoiceOrder(params, orderId);
  }
  const words =
    before.length > 0
      ? `; ${await alreadyInvoicedWords(params, order, before, all)}`
      : "";
  const erp = erpNumbers(params.data, before.length > 0);
  await addComment(params, orderId, note(`Invoiced in the ERP${erp}${words}`));
  return ok(
    all
      ? "Commerce had invoiced these lines already; nothing was invoiced again"
      : "Order invoiced successfully",
  );
}

/** Records how each event ended, for the Admin screen's history (lib/erp-event-history.js). */
const main = recordingErpEvent("invoice", handle);

export { main };
