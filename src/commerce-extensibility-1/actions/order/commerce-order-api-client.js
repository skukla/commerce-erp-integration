import { getCommerceClient } from "@adobe/aio-commerce-lib-app";
import { resolveImsAuthParams } from "@adobe/aio-commerce-sdk/auth";

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
  const client = await getCommerceClient(imsAuthParams);
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
  const client = await getCommerceClient(resolveImsAuthParams(params));
  return await client.get(`orders/${orderId}`).json();
}

/**
 * Invoice an order (capture).
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 */
async function invoiceOrder(params, orderId) {
  const client = await getCommerceClient(resolveImsAuthParams(params));
  return await client.post(`order/${orderId}/invoice`, {
    json: { capture: true, notify: false },
  });
}

/**
 * Cancel an order.
 * @param {object} params - Environment params from the IO Runtime request
 * @param {number} orderId - order id
 */
async function cancelOrder(params, orderId) {
  const client = await getCommerceClient(resolveImsAuthParams(params));
  return await client.post(`orders/${orderId}/cancel`);
}

export { addComment, cancelOrder, getOrder, invoiceOrder };
