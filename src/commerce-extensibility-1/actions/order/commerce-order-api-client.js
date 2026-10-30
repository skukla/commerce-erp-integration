import { getCommerceClient } from "@adobe/aio-commerce-lib-app";
import { resolveImsAuthParams } from "@adobe/aio-commerce-sdk/auth";

import { COMMERCE_FETCH_OPTIONS } from "#lib/commerce";

/**
 * This function call Adobe commerce rest API to add a comment to an order
 *
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 * @param {object} data - Adobe commerce api payload
 */
async function addComment(params, orderId, data) {
  // App Management requires IMS. It's fine to only resolve IMS authentication.
  const imsAuthParams = resolveImsAuthParams(params);
  const client = await getCommerceClient(imsAuthParams, COMMERCE_FETCH_OPTIONS);
  return await client.post(`orders/${orderId}/comments`, {
    json: data,
  });
}

/**
 * Read an order.
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 * @returns {Promise<object>} the order
 */
async function getOrder(params, orderId) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.get(`orders/${orderId}`).json();
}

/**
 * Read an invoice, with its lines (`items[]`: `order_item_id`, `qty`). The Invoice Saved event
 * names no lines; this is where they are read (router/part-fulfilment.js).
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} invoiceId - the invoice's entity id
 * @returns {Promise<object>} the invoice
 */
async function getInvoice(params, invoiceId) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.get(`invoices/${invoiceId}`).json();
}

/**
 * The invoices of an order, with their lines: GET invoices filtered on `order_id` (Commerce's
 * invoice list, sales-invoice-repository getList, answers `{ items, total_count }`).
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - the order's entity id
 * @returns {Promise<object[]>} the invoices
 */
async function listOrderInvoices(params, orderId) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  const page = await client
    .get("invoices", {
      searchParams: {
        "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
        "searchCriteria[filter_groups][0][filters][0][field]": "order_id",
        "searchCriteria[filter_groups][0][filters][0][value]": String(orderId),
      },
    })
    .json();
  return page?.items ?? [];
}

/**
 * Invoice an order (capture).
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 */
async function invoiceOrder(params, orderId) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.post(`order/${orderId}/invoice`, {
    json: { capture: true, notify: false },
  });
}

/**
 * Invoice some of an order's lines (capture), one ERP's part of a split order (design v1 §3.3).
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 * @param {Array<{order_item_id: number, qty: number}>} items - the lines and quantities
 */
async function invoiceOrderItems(params, orderId, items) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.post(`order/${orderId}/invoice`, {
    json: { capture: true, items, notify: false },
  });
}

/**
 * Cancel an order.
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 */
async function cancelOrder(params, orderId) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.post(`orders/${orderId}/cancel`);
}

/**
 * Put an order On Hold (Commerce's own hold: no shipment, invoice or edit until unheld).
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 */
async function holdOrder(params, orderId) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.post(`orders/${orderId}/hold`);
}

/**
 * Take an order off hold.
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 */
async function unholdOrder(params, orderId) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.post(`orders/${orderId}/unhold`);
}

/**
 * A credit memo of some of an order's lines, offline (returns-design.md §3.1 step 7): shipping
 * 0, no adjustment, nothing returned to stock (the ERP owns stock). Measured on the live store
 * 2026-10-02: on a Payment on Account order it credits only these lines, refunds the company
 * credit, and answers the new credit memo's id as a JSON string.
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 * @param {Array<{order_item_id: number, qty: number}>} items - the lines and quantities
 * @param {string} comment - the credit memo's own comment, for staff
 * @returns {Promise<string>} the credit memo id
 */
async function refundOrderItems(params, orderId, items, comment) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client
    .post(`order/${orderId}/refund`, {
      json: {
        appendComment: true,
        arguments: {
          adjustment_negative: 0,
          adjustment_positive: 0,
          extension_attributes: { return_to_stock_items: [] },
          shipping_amount: 0,
        },
        comment: { comment, is_visible_on_front: 0 },
        items,
        notify: false,
      },
    })
    .json();
}

/**
 * Refund what a demo reset refunds (lib/reset-rule.js refundOf): an offline credit memo, the body
 * as given. POST order/{orderId}/refund is the route Adobe documents as "Issues an offline
 * refund" (developer.adobe.com/commerce/webapi/rest/tutorials/orders/order-issue-refund/, read
 * 2026-10-30); its answer is the credit memo's id (measured 2026-10-02, refundOrderItems above).
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 * @param {{ items: object[], notify: boolean, arguments: object }} body - the credit memo
 * @returns {Promise<string>} the credit memo id
 */
async function refundOrder(params, orderId, body) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.post(`order/${orderId}/refund`, { json: body }).json();
}

const NOT_FOUND = 404;

/**
 * The returns (RMA) of an order: GET returns filtered on `order_id` (Adobe's REST reference,
 * GetV1Returns; its search answers `{ items, total_count }` like every Commerce search). NOT
 * captured live. A store without returns answers 404, read as none (as Demo Builder's wipe reads
 * it). Each item carries its header (entity_id, increment_id, status); read the return itself
 * for its items.
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - the order's entity id
 * @returns {Promise<object[]>} the returns
 */
async function listOrderReturns(params, orderId) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  try {
    const page = await client
      .get("returns", {
        searchParams: {
          "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
          "searchCriteria[filter_groups][0][filters][0][field]": "order_id",
          "searchCriteria[filter_groups][0][filters][0][value]":
            String(orderId),
        },
      })
      .json();
    return page?.items ?? [];
  } catch (error) {
    if (error.response?.status === NOT_FOUND) {
      return [];
    }
    throw error;
  }
}

/**
 * Read a return (RMA) with its items.
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} returnId - the return's entity id
 * @returns {Promise<object>} the return
 */
async function getReturn(params, returnId) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.get(`returns/${returnId}`).json();
}

/**
 * Write a return back. Measured 2026-10-02: a body without the return's increment_id gives it
 * a NEW number, so callers send the return as read, changing only statuses and quantities.
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} returnId - the return's entity id
 * @param {object} rma - the whole return, as GET returns/{id} answered it
 */
async function updateReturn(params, returnId, rma) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.put(`returns/${returnId}`, {
    json: { rmaDataObject: rma },
  });
}

/**
 * The words Commerce shows for each return reason, by the option value a return item stores
 * ("12" → "Out of Service"), from GET returnsAttributeMetadata (read live 2026-10-02).
 * @param {object} params - Environment params from the IO Runtime request
 * @returns {Promise<Map<string, string>>}
 */
async function returnReasonLabels(params) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  const attributes = await client.get("returnsAttributeMetadata").json();
  const reason = (attributes ?? []).find((a) => a.attribute_code === "reason");
  return new Map(
    (reason?.options ?? [])
      .filter((o) => o.value !== "" && o.label?.trim())
      .map((o) => [String(o.value), o.label.trim()]),
  );
}

/**
 * Add a staff-only comment to a return.
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} returnId - the return's entity id
 * @param {string} comment - the words
 */
async function addReturnComment(params, returnId, comment) {
  const client = await getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
  return await client.post(`returns/${returnId}/comments`, {
    json: {
      data: {
        // The RMA comment's own field names; the order comment's is_* names are refused
        // ("IsAdmin is not supported", read live 2026-10-02).
        admin: true,
        comment,
        customer_notified: false,
        rma_entity_id: Number(returnId),
        visible_on_front: false,
      },
    },
  });
}

export {
  addComment,
  addReturnComment,
  cancelOrder,
  getInvoice,
  getOrder,
  getReturn,
  holdOrder,
  invoiceOrder,
  invoiceOrderItems,
  listOrderInvoices,
  listOrderReturns,
  refundOrder,
  refundOrderItems,
  returnReasonLabels,
  unholdOrder,
  updateReturn,
};
