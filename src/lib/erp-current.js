import { erp } from "#lib/erp";

/*
 * An ERP product event is a signal that a SKU changed, not the value to write.
 *
 * I/O Events retries and does not keep order, so two quick ERP edits can land in Commerce
 * the wrong way round. Measured on the sandbox 2026-09-25: a rename and its undo each
 * raised an event, both handler runs hit the 60 s limit and were delivered again, and the
 * older one landed last, so Commerce kept a name the ERP had already undone.
 *
 * So the product and stock handlers read the product as the ERP holds it NOW and write
 * that. A late or repeated event then writes the same current values again, and no order
 * of arrival can leave Commerce behind the ERP. The hold handler already works this way
 * (rule M2). Reading a product is a standard ERP API (SAP's product API, Business Central's
 * items), so nothing is asked of the ERP that a real one lacks.
 */

/**
 * The product as the ERP holds it now, or null when the ERP has no such SKU.
 *
 * @param {object} params - the action params (ERP address and credentials)
 * @param {string} sku - the SKU the event named
 * @returns {Promise<object|null>} the ERP's product document, or null on a 404
 * @throws when the ERP is unreachable or answers anything but 2xx or 404, so the event is
 *   delivered again rather than applied from its own (possibly stale) values
 */
export async function currentProduct(params, sku) {
  const answer = await erp.product(params, sku);
  if (answer.status === 404) {
    return null;
  }
  if (!answer.ok) {
    throw new Error(`The ERP answered ${answer.status} for product ${sku}`);
  }
  return answer.data;
}

/**
 * The product event rebuilt from the ERP's current product: its SKU, name and list price.
 * A configurable parent has no price of its own (its variants sell), so it carries none.
 *
 * @param {string} sku - the SKU the event named
 * @param {object} product - the ERP's current product document
 * @returns {{ sku: string, name?: string, price?: number }}
 */
export function currentPriceEvent(sku, product) {
  const event = { sku };
  if (typeof product.name === "string" && product.name) {
    event.name = product.name;
  }
  if (product.type !== "configurable" && Number.isFinite(product.listPrice)) {
    event.price = product.listPrice;
  }
  return event;
}

/**
 * The stock event's lines rebuilt from the ERP's current products: each line's quantity is
 * what the ERP holds in that warehouse now. A line whose product or warehouse the ERP no
 * longer has is dropped.
 *
 * @param {Array<{ sku: string, source: string }>} lines - the event's lines
 * @param {Map<string, object|null>} products - the ERP's current product per SKU
 * @returns {Array<{ sku: string, source: string, quantity: number, outOfStock: boolean }>}
 */
export function currentStockLines(lines, products) {
  const current = [];
  for (const line of lines) {
    const warehouse = products
      .get(line.sku)
      ?.warehouses?.find((w) => w.code === line.source);
    if (!(warehouse && Number.isFinite(warehouse.quantity))) {
      continue;
    }
    current.push({
      outOfStock: warehouse.quantity <= 0,
      quantity: warehouse.quantity,
      sku: line.sku,
      source: line.source,
    });
  }
  return current;
}

/**
 * The ERP's current product for every SKU the lines name, read once each.
 *
 * @param {object} params - the action params
 * @param {Array<{ sku: string }>} lines - the event's lines
 * @returns {Promise<Map<string, object|null>>}
 */
export async function currentProducts(params, lines) {
  const skus = [...new Set(lines.map((line) => line.sku))];
  const products = await Promise.all(
    skus.map((sku) => currentProduct(params, sku)),
  );
  return new Map(skus.map((sku, index) => [sku, products[index]]));
}
