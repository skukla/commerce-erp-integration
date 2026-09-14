/**
 * An ERP product event becomes a sparse product save: name and price. (The kit's sample also
 * wrote a description custom attribute and attribute_set_id; a sparse save is safer on an
 * existing catalog.)
 *
 * @param {object} params - the event (`data`: { sku, name, price })
 * @returns {{ product: object }}
 */
function transformData(params) {
  return {
    product: {
      name: params.data.name,
      price: params.data.price,
      sku: params.data.sku,
    },
  };
}

export { transformData };
