/*
 * Which ERP owns a product (design v1 §2, §3.2): the one place the router and the cart checks
 * ask. An ERP's ownership is its own setting (on its ERP list entry), read through the one
 * ownership rule the integration has (lib/structure.js). By default a product belongs to the
 * ERP whose id its `erp_owner` attribute holds: the attribute a product information system
 * would master, holding the id that never changes.
 */
import { OWNS } from "#lib/structure";

const OWNERSHIP_KEYS = [
  "structure_owns",
  "structure_owns_sources",
  "structure_owns_attribute",
];

/** The product attribute that names a product's owning ERP by the ERP's id. */
export const OWNER_ATTRIBUTE = "erp_owner";

/**
 * An ERP's ownership setting: its own (on its ERP list entry, lib/erp-settings.js), else the
 * owner attribute naming its id.
 */
export function ownershipOf(entry) {
  // `ownership` is B1's in-memory form (never stored: erp/erps keeps `settings`); kept so the
  // router's own tests still read. Stored entries use `settings`.
  if (entry.ownership) {
    return entry.ownership;
  }
  const own = entry.settings ?? {};
  if (own.structure_owns) {
    return Object.fromEntries(
      OWNERSHIP_KEYS.filter((key) => own[key] !== undefined).map((key) => [
        key,
        own[key],
      ]),
    );
  }
  return {
    structure_owns: OWNS.ATTRIBUTE,
    structure_owns_attribute: `${OWNER_ATTRIBUTE}=${entry.id}`,
  };
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
