/*
 * Which ERP owns a product (design v1 §2, §3.2): the one place the router and the cart checks
 * ask. An ERP's ownership is its own setting (on its ERP list entry), read through the one
 * ownership rule the integration has (lib/structure.js). By default a product belongs to the
 * ERP whose id its `erp_owner` attribute holds: the attribute a product information system
 * would master, holding the id that never changes.
 */
import { OWNS } from "#lib/structure";

/** The product attribute that names a product's owning ERP by the ERP's id. */
export const OWNER_ATTRIBUTE = "erp_owner";

/** An ERP's ownership setting: its own, else the owner attribute naming its id. */
export function ownershipOf(entry) {
  return (
    entry.ownership ?? {
      structure_owns: OWNS.ATTRIBUTE,
      structure_owns_attribute: `${OWNER_ATTRIBUTE}=${entry.id}`,
    }
  );
}

/**
 * Which ERPs own a SKU, in list order.
 * @param {object} params action params
 * @param {string} sku the product
 * @param {object[]} erps the ERP list
 * @param {(params: object, sku: string, settings: object) => Promise<boolean>} ownsSku
 * @returns {Promise<string[]>} the owning ERPs' ids
 */
export async function ownersOf(params, sku, erps, ownsSku) {
  const owners = [];
  for (const entry of erps) {
    // biome-ignore lint/performance/noAwaitInLoops: one read per ERP, in list order
    if (await ownsSku(params, sku, ownershipOf(entry))) {
      owners.push(entry.id);
    }
  }
  return owners;
}
