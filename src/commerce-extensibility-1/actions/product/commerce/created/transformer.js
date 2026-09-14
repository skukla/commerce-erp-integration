/**
 * A Commerce product event becomes one ERP material row. The ERP keeps its own list
 * price and stock once a material exists, so a re-import only refreshes the name.
 *
 * @param {object} data - the event's `data` ({ value: product })
 * @returns {object} `{ materials: [row] }`
 */
function transformData(data) {
  const product = data.value ?? data;
  return {
    materials: [
      {
        listPrice: Number(product.price ?? 0),
        name: product.name || product.sku,
        sku: product.sku,
      },
    ],
  };
}

export { transformData };
