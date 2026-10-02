/*
 * The ERP's pending events, delivered the way production delivers them (AB-26y step 6): the
 * ERP builds each CloudEvent in its own words (its lib/events `envelope`, the body it posts),
 * the ingestion webhook's own path validates and translates it (#src/ingestion/translate, via
 * `ingestErpEvent`), and each starter-kit event the translation publishes goes to the handler
 * I/O Events would hand it to (app.commerce.config.ts, eventing.external).
 *
 * Shared by every pair-in-a-box file that delivers ERP events, so they all go through the one
 * translation path. vitest hoists each file's `vi.mock` calls over everything that file
 * imports, this module included.
 */
import * as contractUpdated from "#src/company/external/contract-updated/index";
import * as creditUpdated from "#src/company/external/credit-updated/index";
import * as statusUpdated from "#src/company/external/status-updated/index";
import { ingestErpEvent } from "#src/ingestion/webhook/index";
import * as erpCancelled from "#src/order/external/cancelled/index";
import * as erpCreditMemo from "#src/order/external/creditmemo-created/index";
import * as erpHold from "#src/order/external/hold/index";
import * as erpInvoiceCreated from "#src/order/external/invoice-created/index";
import * as erpPayment from "#src/order/external/payment-received/index";
import * as erpReturnUpdated from "#src/order/external/return-updated/index";
import * as erpShipmentCreated from "#src/order/external/shipment-created/index";
import * as erpStatus from "#src/order/external/updated/index";
import * as erpProduct from "#src/product/external/updated/index";
import * as erpStock from "#src/stock/external/updated/index";

/** Which handler each starter-kit event reaches (app.commerce.config.ts, eventing.external). */
const HANDLERS = {
  "be-observer.catalog_product_update": erpProduct,
  "be-observer.catalog_stock_update": erpStock,
  "be-observer.company_contract_update": contractUpdated,
  "be-observer.company_credit_update": creditUpdated,
  "be-observer.company_status_update": statusUpdated,
  "be-observer.rma_status_update": erpReturnUpdated,
  "be-observer.sales_order_cancel": erpCancelled,
  "be-observer.sales_order_creditmemo_create": erpCreditMemo,
  "be-observer.sales_order_hold": erpHold,
  "be-observer.sales_order_invoice_create": erpInvoiceCreated,
  "be-observer.sales_order_payment_create": erpPayment,
  "be-observer.sales_order_shipment_create": erpShipmentCreated,
  "be-observer.sales_order_status_update": erpStatus,
};

const statusOf = (res) => res.statusCode ?? res.error?.statusCode;

/**
 * Deliver every pending event of one in-process ERP, oldest first.
 * @param {object} erpBox the ERP in this process (erp-in-process.js startErp)
 * @param {{ erpId?: string }} [options] the id the ERP was deployed with (its ERP_ID), which
 *   becomes the CloudEvent's source
 * @returns {Promise<Array<{ event: string, params: object, status: number, statusCode: number,
 *   why?: string }>>} one row per handler run; a row naming the ERP type, with the webhook's
 *   answer, for an event the webhook did not take (it stays pending, as the ERP would retry it)
 */
export async function deliverErpEvents(erpBox, { erpId } = {}) {
  const delivered = [];
  for (const entry of await erpBox.pendingEvents()) {
    const cloudEvent = erpBox.lib.events.envelope(
      entry,
      erpId ? { ERP_ID: erpId } : {},
    );
    const published = [];
    // biome-ignore lint/performance/noAwaitInLoops: events are delivered in order, as they were raised
    const ingested = await ingestErpEvent(
      { ...cloudEvent },
      {
        publish: (event, payload) => {
          published.push({ event, payload });
          return Promise.resolve();
        },
      },
    );
    if (statusOf(ingested) !== 200) {
      delivered.push({
        event: entry.type,
        params: cloudEvent,
        status: statusOf(ingested),
        statusCode: statusOf(ingested),
        why: ingested.error?.body?.message,
      });
      continue;
    }
    for (const { event, payload } of published) {
      const handler = HANDLERS[event];
      if (!handler) {
        throw new Error(`no handler for starter-kit event ${event}`);
      }
      const params = { data: payload, id: entry._id, type: event };
      // biome-ignore lint/performance/noAwaitInLoops: each published event is handled in order, as I/O Events delivers them
      const res = await handler.main(params);
      delivered.push({
        event,
        params,
        status: statusOf(res),
        statusCode: statusOf(res),
        why: res.error?.body?.message,
      });
    }
    await erpBox.markDelivered(entry);
  }
  return delivered;
}
