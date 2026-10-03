/*
 * What Commerce has invoiced of an order already, read when an ERP invoices it. A card paid at
 * checkout with Authorize and Capture makes Commerce invoice every line there and then (AB-26s;
 * owner 2026-10-02, flow 1), so the ERP's invoice later finds nothing left to invoice: asking
 * Commerce again is refused ("The order does not allow an invoice to be created."), and the
 * ERP's event failed and was delivered again for nothing. The ERP's invoice is recorded against
 * the Commerce invoices that already cover its lines instead, and only what is left is invoiced.
 */
import { paymentReferenceOf } from "#lib/payment-reference";
import { listOrderInvoices } from "#src/order/commerce-order-api-client";

const asList = (items) =>
  Array.isArray(items) ? items : Object.values(items ?? {});

/**
 * What each line of a Commerce order has left to invoice: Commerce's quantity to invoice
 * (ordered, less invoiced, less canceled), by order item id.
 * @param {object} order the Commerce order (`items[]`: `item_id`, `qty_ordered`, `qty_invoiced`, `qty_canceled`)
 * @returns {Map<number, number>}
 */
export function openToInvoice(order) {
  return new Map(
    asList(order?.items).map((line) => [
      Number(line.item_id),
      Math.max(
        0,
        Number(line.qty_ordered) -
          Number(line.qty_invoiced ?? 0) -
          Number(line.qty_canceled ?? 0),
      ),
    ]),
  );
}

/** The Commerce invoices of an order that bill any of these lines, by their numbers. */
async function coveringInvoices(params, orderId, itemIds, deps) {
  const invoices = await (deps.listOrderInvoices ?? listOrderInvoices)(
    params,
    orderId,
  );
  return asList(invoices)
    .filter((invoice) =>
      asList(invoice.items).some(
        (item) =>
          itemIds.has(Number(item.order_item_id)) && Number(item.qty) > 0,
      ),
    )
    .map((invoice) => String(invoice.increment_id ?? invoice.entity_id));
}

/**
 * The words for lines of an ERP's invoice that Commerce had invoiced already, for the order's
 * history: where (at checkout, when a card paid; else in Commerce), which Commerce invoices, and
 * what was done instead.
 * @param {object} params action params
 * @param {object} order the Commerce order (`entity_id`, `payment`)
 * @param {Array<{order_item_id: number, sku?: string}>} before the lines Commerce had invoiced
 * @param {boolean} all whether they were all of the ERP invoice's lines (nothing was invoiced)
 * @param {object} [deps] `{ listOrderInvoices }` (test seam)
 * @returns {Promise<string>} e.g. "already invoiced in the web shop at checkout (Commerce
 *   invoice 000000012), so no second invoice was made"
 */
export async function alreadyInvoicedWords(
  params,
  order,
  before,
  all,
  deps = {},
) {
  const numbers = await coveringInvoices(
    params,
    Number(order.entity_id),
    new Set(before.map((line) => Number(line.order_item_id))),
    deps,
  );
  const where =
    paymentReferenceOf(order.payment) === null
      ? "in Commerce"
      : "in the web shop at checkout";
  const which =
    numbers.length > 0 ? ` (Commerce invoice ${numbers.join(" and ")})` : "";
  if (all) {
    return `already invoiced ${where}${which}, so no second invoice was made`;
  }
  const skus = before.map((line) => line.sku ?? `item ${line.order_item_id}`);
  return `${skus.join(", ")} already invoiced ${where}${which}, so only the rest was invoiced`;
}
