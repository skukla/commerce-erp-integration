/*
 * Move stock between inventory sources from the product grid (the integration's own mass
 * action, "Move stock between <ERP> warehouses"), and tell the ERP at once.
 *
 * Commerce's own mass actions (Transfer Inventory To Source, Assign, Unassign) raise no event,
 * measured on Bodea 2026-09-27, and no event exists for a quantity at a source. So the
 * integration makes the move itself, with the same REST calls Commerce's actions make
 * (inventory/bulk-product-source-transfer and bulk-partial-source-transfer, Adobe's
 * "Inventory mass actions" reference), and then sends the ERP each product's stock at every
 * source. Pure over the readers and writers it is handed, so it is tested without either system.
 */

/** Names the move in the ERP's journal (there is no Commerce event behind it). */
export const MOVE_ORIGIN = "moved between warehouses in Commerce Admin";

const SOURCE_CODE = /^[a-z0-9_-]{1,64}$/u;
const PRODUCT_ID = /^\d{1,12}$/u;
const MAX_PRODUCTS = 500;

/** Why a move request cannot be made, in words, or null. */
export function moveProblem(request) {
  const { productIds, from, to, quantity } = request ?? {};
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return "Select the products to move in the product grid.";
  }
  if (productIds.length > MAX_PRODUCTS) {
    return `Move at most ${MAX_PRODUCTS} products at a time.`;
  }
  if (!productIds.every((id) => PRODUCT_ID.test(String(id)))) {
    return "Product ids are numbers.";
  }
  if (!(SOURCE_CODE.test(String(from)) && SOURCE_CODE.test(String(to)))) {
    return "Name the warehouse to move from and the one to move to.";
  }
  if (from === to) {
    return "The two warehouses must differ.";
  }
  if (
    quantity !== undefined &&
    quantity !== null &&
    !(Number.isInteger(quantity) && quantity > 0)
  ) {
    return "A quantity is a whole number above zero, or none to move all of it.";
  }
  return null;
}

/**
 * Make the move in Commerce, then tell the ERP.
 * @param {object} request `{ productIds, from, to, quantity? }`: no quantity moves all of it
 * @param {object} deps `{ skusForProductIds, transferAll, transferSome, warehousesOfSku, importStock }`
 * @returns {Promise<{ moved: string[], erp: "updated" }>}
 */
export async function moveStock(params, request, deps) {
  const skus = await deps.skusForProductIds(params, request.productIds);
  if (skus.length === 0) {
    throw new Error("None of the selected products was found in Commerce.");
  }
  if (request.quantity) {
    await deps.transferSome(
      params,
      skus.map((sku) => ({ qty: request.quantity, sku })),
      request.from,
      request.to,
    );
  } else {
    await deps.transferAll(params, skus, request.from, request.to);
  }
  const stock = [];
  for (const sku of skus) {
    // biome-ignore lint/performance/noAwaitInLoops: one read per product, a few hundred at most, in order
    stock.push({ sku, warehouses: await deps.warehousesOfSku(params, sku) });
  }
  const answer = await deps.importStock(params, {
    origin: { event: MOVE_ORIGIN },
    stock,
  });
  if (!answer.ok) {
    throw new Error(
      `Moved in Commerce, but the ERP answered ${answer.status}: ${answer.data?.errorMessage || "no reason given"}`,
    );
  }
  return { erp: "updated", moved: skus };
}
