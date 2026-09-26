/**
 * A Commerce stock item becomes `{ productId, stock }`; the sender resolves the SKU,
 * which the stock event does not carry.
 *
 * @param {object} data - the event's `data` (`value` is the stock item), as `main` hands it
 * @returns {{ productId: number, stock: number }}
 */
function transformData(data) {
  const item = data.value ?? data;
  return {
    productId: Number(item.product_id),
    stock: Math.max(0, Math.floor(Number(item.qty))),
  };
}

export { transformData };
