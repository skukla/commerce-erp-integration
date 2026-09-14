/**
 * A stock event is usable when it names a product and a quantity.
 *
 * @param {object} params - the action params (`data.value` is the stock item)
 * @returns {{ success: boolean, message?: string }}
 */
function validateData(params) {
  const item = params?.data?.value ?? params?.data;
  if (!item?.product_id) {
    return { message: "the stock event carries no product_id", success: false };
  }
  if (!Number.isFinite(Number(item.qty))) {
    return { message: "the stock event carries no qty", success: false };
  }
  return { success: true };
}

export { validateData };
