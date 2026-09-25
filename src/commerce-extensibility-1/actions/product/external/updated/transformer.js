/**
 * An ERP product event becomes a sparse product save: name and price. (The kit's sample also
 * wrote a description custom attribute and attribute_set_id; a sparse save is safer on an
 * existing catalog.)
 *
 * @param {object} params - the event (`data`: { sku, name, price })
 * @returns {{ product: object }}
 */
function transformData(params) {
  const product = { sku: params.data.sku };
  // A configurable parent carries no price (lib/erp-current.js); a name may be absent too.
  if (params.data.name !== undefined) {
    product.name = params.data.name;
  }
  if (params.data.price !== undefined) {
    product.price = params.data.price;
  }
  return { product };
}

export { transformData };
