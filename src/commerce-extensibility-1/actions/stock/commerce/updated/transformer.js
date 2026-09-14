/**
 * A Commerce stock item becomes `{ productId, stock }`; the sender resolves the SKU,
 * which the stock event does not carry.
 *
 * @param {object} params - the action params
 * @returns {{ productId: number, stock: number }}
 */
function transformData(params) {
  const item = params.data.value ?? params.data;
  return {
    productId: Number(item.product_id),
    stock: Math.max(0, Math.floor(Number(item.qty))),
  };
}

export { transformData };
