import { getCommerceClient } from "@adobe/aio-commerce-lib-app";
import { resolveImsAuthParams } from "@adobe/aio-commerce-sdk/auth";

import { COMMERCE_FETCH_OPTIONS } from "#lib/commerce";

/**
 * This function call Adobe commerce rest API to update the stock of a sku in a source
 *
 * @returns - API response object
 * @param {object} params - Environment params from the IO Runtime request
 * @param {object} data - Adobe commerce api payload
 */
async function updateStock(params, data) {
  // App Management requires IMS. It's fine to only resolve IMS authentication.
  const imsAuthParams = resolveImsAuthParams(params);
  const client = await getCommerceClient(imsAuthParams, COMMERCE_FETCH_OPTIONS);
  return await client.post("inventory/source-items", {
    json: data,
  });
}

export { updateStock };
