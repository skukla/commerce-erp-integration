/*
 * Which ERP owns a product (design v1 §2, §3.2): the one place the router and the cart checks
 * ask. An ERP's ownership is its own setting (on its ERP list entry), read through the one
 * ownership rule the integration has (lib/structure.js). By default a product belongs to the
 * ERP whose id its `erp_owner` attribute holds: the attribute a product information system
 * would master, holding the id that never changes.
 */
import { OWNS, PRODUCT_MODES } from "#lib/structure";

const OWNERSHIP_KEYS = [
  "structure_owns",
  "structure_owns_attribute",
  "structure_owns_websites",
];

/** The product attribute that names a product's owning ERP by the ERP's id. */
export const OWNER_ATTRIBUTE = "erp_owner";

/**
 * An ERP's ownership setting: its own (on its ERP list entry, lib/erp-settings.js), else the
 * owner attribute naming its id.
 */
export function ownershipOf(entry) {
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

/** The ERPs whose ownership decides by the product itself, and those deciding by website. */
function byRuleKind(erps) {
  const product = [];
  const website = [];
  for (const entry of erps) {
    const mode = ownershipOf(entry).structure_owns;
    (PRODUCT_MODES.includes(mode) ? product : website).push(entry);
  }
  return { product, website };
}

async function owning(params, line, entries, ownsSku) {
  const owners = [];
  for (const entry of entries) {
    // biome-ignore lint/performance/noAwaitInLoops: one read per ERP, in list order
    if (await ownsSku(params, line.sku, ownershipOf(entry), line.websiteCode)) {
      owners.push(entry.id);
    }
  }
  return owners;
}

/**
 * Which ERPs own a line, in list order: a SKU, with the website the order came from when
 * there is an order.
 *
 * A PRODUCT RULE BEATS A WEBSITE RULE (owner, 2026-10-02; AB-64). A cart belongs to one
 * website, so an order comes from exactly one, and a website rule can only ever send the
 * whole order to one ERP. When ERPs mix rule kinds: if any ERP owns the SKU by its attribute,
 * its inventory source or `all`, those are the line's owners (one owner sends, two is a setup
 * error, as ever); only when no product-rule ERP owns the SKU does the ERP owning the order's
 * website take it. The website rule is the catch-all for that site.
 * @param {object} params action params
 * @param {{ sku: string, websiteCode?: string }} line the product, and the order's website
 * @param {object[]} erps the ERP list
 * @param {(params: object, sku: string, settings: object, websiteCode?: string) =>
 *   Promise<boolean>} ownsSku
 * @returns {Promise<string[]>} the owning ERPs' ids
 */
export async function ownersOfLine(params, line, erps, ownsSku) {
  const { product, website } = byRuleKind(erps);
  const byProduct = await owning(params, line, product, ownsSku);
  if (byProduct.length > 0 || website.length === 0) {
    return byProduct;
  }
  return owning(params, line, website, ownsSku);
}

/**
 * Which ERPs own a SKU asked about on its own (no order), in list order.
 * @param {object} params action params
 * @param {string} sku the product
 * @param {object[]} erps the ERP list
 * @param {(params: object, sku: string, settings: object) => Promise<boolean>} ownsSku
 * @returns {Promise<string[]>} the owning ERPs' ids
 */
export function ownersOf(params, sku, erps, ownsSku) {
  return ownersOfLine(params, { sku }, erps, ownsSku);
}
