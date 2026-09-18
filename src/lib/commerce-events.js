/*
 * The Commerce events this app subscribes to (app.commerce.config.ts), named once.
 *
 * Every write to the ERP that one of them triggers carries `origin: { event }`, so the
 * ERP's Events log can show what arrived from Commerce and which change brought it.
 * Without it, a change that reached the ERP left no trace on the screen an SC checks
 * (2026-09-18: a product rename arrived and nothing said so).
 */
export const COMMERCE_EVENTS = {
  orderSaved: "observer.sales_order_save_commit_after",
  productSaved: "observer.catalog_product_save_commit_after",
  stockItemSaved: "observer.cataloginventory_stock_item_save_commit_after",
};

/** The `origin` an ERP write carries for one of those events. */
export function originOf(event) {
  return { event };
}
