/**
 * A Commerce product event becomes one ERP product row. The ERP keeps its own list
 * price and stock once a product exists, so a re-import only refreshes the name.
 *
 * @param {object} data - the event's `data` ({ value: product })
 * @returns {object} `{ products: [row] }`
 */
function transformData(data) {
  const product = data.value ?? data;
  return {
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
