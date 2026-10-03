/*
 * What the ERP's words mean here: the ONE translation module (AB-26y step 6).
 *
 * The ERP speaks its own language (its contract version 16): every event is a CloudEvents 1.0
 * envelope whose `type` is object + action in the ERP's words (SalesOrder.Changed,
 * BillingDocument.Created, …) and whose `data` is its own record (SalesOrder,
 * PurchaseOrderByCustomer, CustomerLineReference, …). Nothing of Commerce's rides along. This
 * module turns each into the starter-kit back-office event and the payload the order, product,
 * stock and company handlers already take, so those handlers stay as they are.
 *
 * Commerce's ids come from this app's own records and reads, never from the ERP:
 * - an order's entity id from Commerce, by the order number the customer's reference is
 *   (PurchaseOrderByCustomer; lib/commerce findOrderByIncrementId);
 * - an order item id is the customer's line reference (CustomerLineReference), which this app
 *   sent the ERP as the item id (lib/order-sync.js);
 * - a return's entity id is the customer's reference for the return, which this app sent as
 *   the return's id (router/return-pieces.js), the key of its order-returns record;
 * - a customer's Commerce company stays the key map's to find (lib/key-map.js): the company
 *   handlers read it from the ERP's customer number they are given.
 * Blocking levels fold here to the one thing Commerce knows: blocked or not.
 *
 * If the ERP ever sends notices instead of whole records, only this module changes.
 */
import { findOrderByIncrementId } from "#lib/commerce";

const SPEC_VERSION = "1.0";
/** `/erp` (the single ERP) or `/erp/<id>`, the id this app's ERP list gives it. */
const ERP_SOURCE = /^\/erp(?:\/([a-z][a-z0-9-]{0,62}))?$/u;
const REQUIRED = ["specversion", "id", "source", "type"];

const BAD_REQUEST = 400;
const UNAVAILABLE = 503;

const EVENTS = Object.freeze({
  cancel: "be-observer.sales_order_cancel",
  companyContract: "be-observer.company_contract_update",
  companyCredit: "be-observer.company_credit_update",
  companyStatus: "be-observer.company_status_update",
  creditMemo: "be-observer.sales_order_creditmemo_create",
  hold: "be-observer.sales_order_hold",
  invoice: "be-observer.sales_order_invoice_create",
  payment: "be-observer.sales_order_payment_create",
  product: "be-observer.catalog_product_update",
  returnReceived: "be-observer.rma_status_update",
  shipment: "be-observer.sales_order_shipment_create",
  status: "be-observer.sales_order_status_update",
  stock: "be-observer.catalog_stock_update",
});

/** Every starter-kit event this module can publish: the app's external subscriptions. */
export const STARTER_KIT_EVENTS = Object.freeze(Object.values(EVENTS));

/**
 * Whether a body is a CloudEvent 1.0 from an ERP, before anything is read from it.
 * @param {object} body the delivered body (the action params)
 * @returns {{ success: true } | { success: false, message: string }}
 */
export function validateCloudEvent(body) {
  const missing = REQUIRED.filter(
    (key) => typeof body?.[key] !== "string" || !body[key],
  );
  if (missing.length > 0) {
    return {
      message: `not a CloudEvent 1.0: missing ${missing.join(", ")}`,
      success: false,
    };
  }
  if (body.specversion !== SPEC_VERSION) {
    return {
      message: `CloudEvents ${body.specversion} is not ${SPEC_VERSION}`,
      success: false,
    };
  }
  if (!ERP_SOURCE.test(body.source)) {
    return {
      message: `source ${body.source} is not an ERP (/erp or /erp/<id>)`,
      success: false,
    };
  }
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return { message: "the event carries no data record", success: false };
  }
  return { success: true };
}

/** Commerce's order item ids are whole numbers; the customer's line reference must be one. */
const ITEM_ID = /^[0-9]+$/u;
const listOf = (items) => (Array.isArray(items) ? items : []);
/** Whether an ERP line names a Commerce order line: missing, empty and non-numeric do not. */
const namesLine = (i) => ITEM_ID.test(String(i?.CustomerLineReference ?? ""));
/** Whether an ERP order event names a web shop order: the customer's order number. */
const namesOrder = (d) =>
  typeof d.PurchaseOrderByCustomer === "string" &&
  d.PurchaseOrderByCustomer.trim() !== "";

/**
 * The ERP's items as the handlers' order items: Commerce's item id is the customer's line
 * reference. A line that names none is left out, which is safe only for a message that acts on
 * no line (a sales order change); a document's lines are checked first (unmappedLine).
 */
function orderItems(items) {
  return listOf(items)
    .filter(namesLine)
    .map((i) => ({
      orderItemId: Number(i.CustomerLineReference),
      qty: i.Quantity,
      sku: i.Material,
    }));
}

/** A return's Commerce id: the customer's reference for it, or null when it names none. */
function returnId(reference) {
  return reference === null || reference === undefined || reference === ""
    ? null
    : Number(reference);
}

/** The order fields every order message starts with. */
const head = (data, entityId) => ({
  erpNumber: data.SalesOrder,
  id: entityId,
  incrementId: data.PurchaseOrderByCustomer,
  orderId: entityId,
});

const BLOCKS = (level) => level !== "open";

/*
 * Each ERP type, as the starter-kit events it means. An order type is handed Commerce's
 * entity id for the order; the rest are not. A function answers a list: one ERP change can
 * mean two things to Commerce (a credit limit AND a block), or none (a sales status).
 */
const ORDER_TYPES = {
  "BillingDocument.Created": (d, id) =>
    d.BillingDocumentType === "CreditMemo"
      ? [
          {
            event: EVENTS.creditMemo,
            payload: {
              ...head(d, id),
              commerceReturnId: returnId(d.CustomerReturnReference),
              creditMemoNumber: d.BillingDocument,
              items: orderItems(d.Items),
              notifyCustomer: false,
              returnNumber: d.CustomerReturn ?? null,
              total: d.TotalGrossAmount,
            },
          },
        ]
      : [
          {
            event: EVENTS.invoice,
            payload: {
              ...head(d, id),
              items: orderItems(d.Items),
              notifyCustomer: false,
              status: "invoiced",
            },
          },
        ],
  "CustomerReturn.Changed": (d, id) =>
    d.Status === "received"
      ? [
          {
            event: EVENTS.returnReceived,
            payload: {
              ...head(d, id),
              commerceReturnId: returnId(d.CustomerReturnReference),
              items: orderItems(d.Items),
              returnNumber: d.CustomerReturn,
              status: d.Status,
            },
          },
        ]
      : [],
  "IncomingPayment.Posted": (d, id) => [
    {
      event: EVENTS.payment,
      payload: {
        ...head(d, id),
        amount: d.Amount,
        currency: d.Currency,
        invoiceNumber: d.BillingDocument,
        partnerId: d.Customer,
        paymentNumber: d.Payment,
        reference: d.PaymentReference ?? null,
      },
    },
  ],
  "OutboundDelivery.GoodsIssueStatusChanged": (d, id) => [
    {
      event: EVENTS.shipment,
      payload: {
        ...head(d, id),
        items: orderItems(d.Items),
        notifyCustomer: false,
        status: "shipped",
        stockSourceCode: d.Plant ?? null,
      },
    },
  ],
  "SalesOrder.Changed": (d, id) => salesOrderEvents(d, id),
};

/** A sales order change: a cancel, a confirmation, a hold or a release, told apart by what it was before. */
function salesOrderEvents(d, id) {
  const order = {
    ...head(d, id),
    items: orderItems(d.Items),
    notifyCustomer: false,
  };
  const events = [];
  const moved = (status) =>
    d.OverallStatus === status && d.PrevOverallStatus !== status;
  if (moved("canceled")) {
    // A reject is a cancel, and the cancel handler takes the order off hold first.
    return [
      {
        event: EVENTS.cancel,
        payload: { ...order, reason: d.Reason ?? null, status: "canceled" },
      },
    ];
  }
  if (Boolean(d.CreditBlock) !== Boolean(d.PrevCreditBlock)) {
    events.push({
      event: EVENTS.hold,
      payload: {
        ...order,
        held: Boolean(d.CreditBlock),
        reason: d.CreditBlock ? (d.Reason ?? null) : null,
        status: d.OverallStatus,
      },
    });
  }
  if (moved("confirmed")) {
    events.push({
      event: EVENTS.status,
      payload: { ...order, status: d.OverallStatus },
    });
  }
  return events;
}

const changed = (d, field) =>
  Array.isArray(d.ChangedFields) && d.ChangedFields.includes(field);

const MASTER_TYPES = {
  "Customer.Changed": (d) => {
    const events = [];
    if (changed(d, "CreditLimit")) {
      events.push({
        event: EVENTS.companyCredit,
        payload: { creditLimit: d.CreditLimit, partnerId: d.Customer },
      });
    }
    // Commerce knows a customer as blocked or not: a move between two levels that both block
    // (shipping to invoicing) is the ERP's own business and means nothing there.
    if (
      changed(d, "BlockingLevel") &&
      BLOCKS(d.BlockingLevel) !== BLOCKS(d.PrevBlockingLevel)
    ) {
      events.push({
        event: EVENTS.companyStatus,
        payload: { blocked: BLOCKS(d.BlockingLevel), partnerId: d.Customer },
      });
    }
    return events;
  },
  "PriceList.Changed": (d) => [
    {
      event: EVENTS.companyContract,
      payload: { lines: d.Lines, partnerId: d.Customer },
    },
  ],
  // A sales status is the ERP's own: only a name or list price is Commerce's to hear.
  "Product.Changed": (d) =>
    changed(d, "ProductName") || changed(d, "ListPrice")
      ? [
          {
            event: EVENTS.product,
            payload: {
              name: d.ProductName,
              price: d.ListPrice,
              sku: d.Product,
            },
          },
        ]
      : [],
  "ProductStock.Changed": (d) => [
    {
      event: EVENTS.stock,
      payload: [
        {
          outOfStock: d.Quantity <= 0,
          quantity: d.Quantity,
          sku: d.Product,
          source: d.Plant,
        },
      ],
    },
  ],
};

/*
 * The ERP documents that act on Commerce lines: what each is called, its number, and what
 * did not happen when it is refused. Null for one that publishes nothing.
 */
const DOCUMENTS = {
  "BillingDocument.Created": (d) =>
    d.BillingDocumentType === "CreditMemo"
      ? { done: "credited", name: "Credit memo", number: d.BillingDocument }
      : { done: "invoiced", name: "Invoice", number: d.BillingDocument },
  "CustomerReturn.Changed": (d) =>
    d.Status === "received"
      ? { done: "received", name: "Return", number: d.CustomerReturn }
      : null,
  "OutboundDelivery.GoodsIssueStatusChanged": (d) => ({
    done: "shipped",
    name: "Shipment",
    number: d.OutboundDelivery,
  }),
};

/**
 * Why a document cannot be translated: one of its lines names no Commerce order line. Null
 * when every line does.
 *
 * The WHOLE document is refused, not published with the lines that could be mapped: leaving
 * a line out would silently drop goods (a shipment short a line, an invoice short an amount),
 * and with none left the handlers were handed an empty list, which Commerce reads as the
 * whole order. Refused, the ERP journals the reason and staff see it.
 */
function unmappedLine(type, data) {
  const document = DOCUMENTS[type]?.(data);
  const line = document ? listOf(data.Items).find((i) => !namesLine(i)) : null;
  return line
    ? `${document.name} ${document.number} line ${line.SalesOrderItem} names no web shop line; nothing was ${document.done} in the web shop.`
    : null;
}

/*
 * The change of this integration's own an ERP event would echo (AB-26y step 5, the ERP's
 * contract version 19): what lib/own-writes.js recorded when the change, made in Commerce, was
 * sent to the ERP (lib/commerce-changes.js, router/part-fulfilment.js). Only these five are
 * ever sent; any other event is the ERP's own and echoes nothing.
 */
const CHANGES = {
  "BillingDocument.Created": (d) =>
    d.BillingDocumentType === "Invoice" ? { kind: "invoice" } : null,
  "OutboundDelivery.GoodsIssueStatusChanged": (d) => ({
    kind: "shipment",
    lines: listOf(d.Items).map((i) => ({
      customerLineReference: i.CustomerLineReference,
      qty: i.Quantity,
    })),
  }),
  "SalesOrder.Changed": (d) => {
    if (d.OverallStatus === "canceled" && d.PrevOverallStatus !== "canceled") {
      return { kind: "cancel" };
    }
    if (Boolean(d.CreditBlock) === Boolean(d.PrevCreditBlock)) {
      return null;
    }
    return { kind: d.CreditBlock ? "hold" : "release" };
  },
};

/**
 * The change an ERP event would echo, in lib/own-writes.js's words; null for one it cannot.
 * @param {string} type the ERP's event type
 * @param {object} data its data
 * @returns {{ kind: string, salesOrder: string, lines?: object[] } | null}
 */
export function erpChangeOf(type, data) {
  const change = Object.hasOwn(CHANGES, type) ? CHANGES[type](data) : null;
  return change ? { ...change, salesOrder: data.SalesOrder } : null;
}

/** Every ERP event type this module translates (the ERP contract's `events.types`). */
export const TRANSLATIONS = Object.freeze({ ...ORDER_TYPES, ...MASTER_TYPES });

/** The ERP's id rides on an object payload, as the handlers read it; a stock list is routed by its product. */
const named = (payload, erpId) =>
  erpId && !Array.isArray(payload) ? { ...payload, erpId } : payload;

/**
 * Translate one ERP event.
 * @param {object} params the action params (Commerce credentials, for an order's id)
 * @param {object} cloudEvent the delivered CloudEvent (validateCloudEvent passed)
 * @param {{ findOrder?: Function }} [deps] `findOrder(params, incrementId)` (test seam)
 * @returns {Promise<{ ok: true, erpId?: string, events: Array<{ event: string, payload: object }>,
 *   skipped?: string }
 *   | { ok: false, statusCode: number, message: string }>}
 */
export async function translateErpEvent(params, cloudEvent, deps = {}) {
  const { data, source, type } = cloudEvent;
  const erpId = ERP_SOURCE.exec(source)?.[1];
  if (!Object.hasOwn(TRANSLATIONS, type)) {
    return {
      message: `unknown ERP event type ${type}`,
      ok: false,
      statusCode: BAD_REQUEST,
    };
  }
  if (Object.hasOwn(ORDER_TYPES, type) && !namesOrder(data)) {
    // An order the ERP made itself (Repeat order, contract version 19): the web shop never had
    // it, so there is nothing to change there and no order to create. Answered, not refused:
    // delivering it again would change nothing.
    return {
      erpId,
      events: [],
      ok: true,
      skipped: `sales order ${data.SalesOrder} was made in the ERP; the web shop has no order for it`,
    };
  }
  const unmapped = unmappedLine(type, data);
  if (unmapped) {
    // A 400: delivering it again changes nothing, so the ERP's journal keeps the reason.
    return { message: unmapped, ok: false, statusCode: BAD_REQUEST };
  }
  let entityId;
  if (Object.hasOwn(ORDER_TYPES, type)) {
    const found = await (deps.findOrder ?? findOrderByIncrementId)(
      params,
      data.PurchaseOrderByCustomer,
    );
    if (!found) {
      return {
        message: `Commerce has no order ${data.PurchaseOrderByCustomer} yet`,
        ok: false,
        statusCode: UNAVAILABLE,
      };
    }
    ({ entityId } = found);
  }
  const events = TRANSLATIONS[type](data, entityId).map((e) => ({
    event: e.event,
    payload: named(e.payload, erpId),
  }));
  return { erpId, events, ok: true };
}
