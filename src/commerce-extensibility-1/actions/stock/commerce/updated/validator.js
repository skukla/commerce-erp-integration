/**
 * A stock event is usable when it names a product and a quantity.
 *
 * @param {object} data - the event's `data` (`value` is the stock item), as `main` hands it
 * @returns {{ success: boolean, message?: string }}
 */
function validateData(data) {
  const item = data?.value ?? data;
  if (!item?.product_id) {
    return { message: "the stock event carries no product_id", success: false };
  }
  if (!Number.isFinite(Number(item.qty))) {
    return { message: "the stock event carries no qty", success: false };
  }
  return { success: true };
}

export { validateData };
