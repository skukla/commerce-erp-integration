/*
 * The Commerce reads a store-scoped close needs (erp/close-orders, lib/close-store-orders.js):
 * the store's structure, and the orders placed in some store views. Apart from lib/commerce.js
 * so the close's reads can be stood in for on their own.
 */
import { commerceClient, readAllPages } from "#lib/commerce";

/**
 * The store's three lists: `GET store/websites`, `GET store/storeGroups`, `GET store/storeViews`
 * (read-only on every platform; the same three Demo Builder's store discovery reads).
 * @param {object} params action params
 * @returns {Promise<{ websites: object[], storeGroups: object[], storeViews: object[] }>}
 */
export async function readStoreStructure(params) {
  const client = await commerceClient(params);
  const [websites, storeGroups, storeViews] = await Promise.all([
    client.get("store/websites").json(),
    client.get("store/storeGroups").json(),
    client.get("store/storeViews").json(),
  ]);
  return {
    storeGroups: storeGroups ?? [],
    storeViews: storeViews ?? [],
    websites: websites ?? [],
  };
}

/**
 * The ids of every order placed in these store views: `GET orders` filtered on `store_id` in
 * the views, every page, only the fields named (an order list is otherwise read whole). NOT
 * captured live; the `in` condition and `fields` are Commerce's search criteria.
 * @param {object} params action params
 * @param {number[]} viewIds the store views
 * @returns {Promise<string[]>} the orders' entity ids
 */
export async function orderIdsInViews(params, viewIds) {
  if (viewIds.length === 0) {
    return [];
  }
  const client = await commerceClient(params);
  const orders = await readAllPages(client, "orders", {
    fields: "items[entity_id,store_id],total_count",
    "searchCriteria[filter_groups][0][filters][0][condition_type]": "in",
    "searchCriteria[filter_groups][0][filters][0][field]": "store_id",
    "searchCriteria[filter_groups][0][filters][0][value]": viewIds.join(","),
  });
  return orders.map((order) => String(order.entity_id));
}
