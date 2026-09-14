/**
 * A product event is usable when it names a SKU.
 *
 * @param {object} data - the event's `data`
 * @returns {{ success: boolean, message?: string }}
 */
function validateData(data) {
  const product = data?.value ?? data;
  if (!product?.sku) {
    return { message: "the product event carries no sku", success: false };
  }
  return { success: true };
}

export { validateData };
