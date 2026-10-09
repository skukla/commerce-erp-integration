/*
 * Which ERP owns a product (design v1 §2, §3.2): the one place the router and the cart checks
 * ask. An ERP's ownership is its own setting (on its ERP list entry), read through the one
 * ownership rule the integration has (lib/structure.js). By default a product belongs to the
 * ERP whose id its `erp_owner` attribute holds: the attribute a product information system
 * would master, holding the id that never changes. An ERP owning `all` is the catch-all: it
 * owns every product no other ERP claims by a product rule (ownersOfLine).
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

/**
 * The ERPs by the kind of rule they own by: a SPECIFIC product rule (the product's attribute),
 * the catch-all (`all`), or a website rule.
 */
function byRuleKind(erps) {
  const specific = [];
  const all = [];
  const website = [];
  for (const entry of erps) {
    const mode = ownershipOf(entry).structure_owns;
    if (mode === OWNS.ATTRIBUTE) {
      specific.push(entry);
    } else if (PRODUCT_MODES.includes(mode)) {
      all.push(entry);
    } else {
      website.push(entry);
    }
  }
  return { all, specific, website };
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
 * there is an order. The claims are resolved in three rounds, and the first round with an
 * owner decides:
 *
 * 1. the ERPs owning by a specific product rule (the product's attribute). If any owns the
 *    SKU, those are the owners; two is a setup error, as ever.
 * 2. else the ERPs owning `all`: THE CATCH-ALL (owner, 2026-10-09). An `all` ERP owns every
 *    product no other ERP claims by a product rule, and never competes with an attribute ERP
 *    for a tagged product. Two `all` ERPs both claim, which is the same setup error. Measured
 *    on Justrite: Justrite owned `all`, Accuform owned erp_owner=accuform, and an Accuform
 *    sign was refused as "claimed by justrite and accuform"; now it goes to Accuform and the
 *    untagged products to Justrite.
 * 3. else the ERPs owning by website. A PRODUCT RULE BEATS A WEBSITE RULE (owner,
 *    2026-10-02; AB-64): a cart belongs to one website, so an order comes from exactly one,
 *    and a website rule can only ever send the whole order to one ERP. The website rule is
 *    the catch-all for that site.
 * @param {object} params action params
 * @param {{ sku: string, websiteCode?: string }} line the product, and the order's website
 * @param {object[]} erps the ERP list
 * @param {(params: object, sku: string, settings: object, websiteCode?: string) =>
 *   Promise<boolean>} ownsSku
 * @returns {Promise<string[]>} the owning ERPs' ids
 */
export async function ownersOfLine(params, line, erps, ownsSku) {
  const { all, specific, website } = byRuleKind(erps);
  for (const round of [specific, all, website]) {
    // biome-ignore lint/performance/noAwaitInLoops: each round is asked only when the one before owned nothing
    const owners = await owning(params, line, round, ownsSku);
    if (owners.length > 0) {
      return owners;
    }
  }
  return [];
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
