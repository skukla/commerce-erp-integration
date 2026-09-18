import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";

/**
 * A Commerce product event becomes one ERP product row: its name and its price, which
 * the ERP takes (Commerce is the master the demo is prepared in, plan decision 3). Stock
 * is not sent here; the stock-item event carries it. This comment used to say the ERP
 * kept its own list price on a re-import, which the ERP's import has never done.
 *
 * @param {object} data - the event's `data` ({ value: product })
 * @returns {object} `{ products: [row] }`
 */
function transformData(data) {
  const product = data.value ?? data;
  return {
    origin: originOf(COMMERCE_EVENTS.productSaved),
    products: [
      {
        listPrice: Number(product.price ?? 0),
        name: product.name || product.sku,
        sku: product.sku,
      },
    ],
  };
}

export { transformData };
