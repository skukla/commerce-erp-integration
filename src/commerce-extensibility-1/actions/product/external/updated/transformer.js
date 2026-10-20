/**
 * An ERP product event becomes a sparse product save of exactly the fields that changed:
 * a rename writes the name and leaves the price alone (AB-60). The event says which in
 * `changed` (Commerce's names), translated from the ERP's ChangedFields.
 *
 * @param {object} params - the event (`data`: { sku, changed, name?, price?, previous })
 * @returns {{ product: object }}
 */
function transformData(params) {
  const { data } = params;
  const product = { sku: data.sku };
  for (const field of data.changed) {
    product[field] = data[field];
  }
  return { product };
}

export { transformData };
