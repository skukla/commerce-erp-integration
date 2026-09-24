/*
 * The seller side of the structure, as the integration carries it (business-structure
 * plan, step 02): which sales organisation an order belongs to, and the prefix that tells
 * one ERP's order numbers from another's on the same Commerce store.
 *
 * Multi-ERP rule M4 (owner, 2026-09-24): the number written onto a Commerce order is
 * `ACME-0000001042`. The prefix is added on the way out and stripped on the way in; the
 * ERP itself never sees it. Two ERPs both number from 0000001000, so the prefix is what
 * makes "is this order mine?" answerable before asking the ERP (rule M2).
 */

const PREFIX = /^[A-Z0-9]{1,6}$/u;
const EXT_ORDER_ID = /^(?:([A-Z0-9]{1,6})-)?(\d{10})$/u;
const FALLBACK_PREFIX = "ERP";
const DERIVED_LENGTH = 4;

/**
 * The prefix this pair puts on its order numbers: the setting, else the first letters
 * and digits of the ERP's name, upper-cased (`Acme ERP` → `ACME`), else `ERP`.
 * @param {object} [settings] the pair's settings (Default Config carries the prefix)
 * @param {object} [params] the action params (`ERP_DISPLAY_NAME`)
 */
export function orderPrefix(settings, params) {
  const set = settings?.structure_order_prefix;
  if (typeof set === "string" && PREFIX.test(set)) {
    return set;
  }
  const derived = String(params?.ERP_DISPLAY_NAME ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "")
    .slice(0, DERIVED_LENGTH);
  return derived || FALLBACK_PREFIX;
}

/** `ACME-0000001042` */
export const withPrefix = (number, prefix) => `${prefix}-${number}`;

/**
 * What a Commerce order's ext_order_id says: the prefix (null before prefixes existed)
 * and the ERP number (null when the field holds something that is not an ERP number).
 * @param {string|null|undefined} extOrderId
 * @returns {{ prefix: string|null, number: string|null }}
 */
export function splitExtOrderId(extOrderId) {
  const text = typeof extOrderId === "string" ? extOrderId.trim() : "";
  if (!text) {
    return { number: null, prefix: null };
  }
  const match = EXT_ORDER_ID.exec(text);
  if (!match) {
    return { number: null, prefix: null };
  }
  return { number: match[2], prefix: match[1] ?? null };
}

/**
 * The sales organisation an order from a website belongs to: the website's setting, else
 * `1000` (a store with one website and no setting is one sales organisation).
 * @param {object} [settings] the settings read for the order's store view
 * @returns {{ salesOrg: string, salesOrgName?: string }}
 */
export function salesOrgOf(settings) {
  const salesOrg =
    typeof settings?.structure_sales_org === "string" &&
    settings.structure_sales_org
      ? settings.structure_sales_org
      : "1000";
  const name = settings?.structure_sales_org_name;
  return typeof name === "string" && name
    ? { salesOrg, salesOrgName: name }
    : { salesOrg };
}

/** The ownership modes (rule M3): which products belong to this ERP. */
export const OWNS = Object.freeze({
  ALL: "all",
  ATTRIBUTE: "attribute",
  SOURCES: "sources",
});

/** "default, east" → ["default", "east"] */
const codesOf = (text) =>
  String(text ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

/** "erp_owner=ACME" → { code: "erp_owner", value: "ACME" }, or null */
function attributeOf(text) {
  const at = String(text ?? "").indexOf("=");
  if (at <= 0) {
    return null;
  }
  return {
    code: text.slice(0, at).trim(),
    value: text.slice(at + 1).trim(),
  };
}

/**
 * Which products belong to this ERP, from the pair's settings (rule M3). `owns` takes a
 * product as the mirror sees it: `sourceCodes` (the inventory sources it is stocked in)
 * and `customAttributes` (code → value). Under `all` every product is owned, which is
 * today's single-pair behaviour; a mode whose setting is blank owns nothing, loudly.
 * @returns {{ mode: string, owns: (product: object) => boolean, describe: string }}
 */
export function ownershipFilter(settings) {
  const mode = settings?.structure_owns || OWNS.ALL;
  if (mode === OWNS.SOURCES) {
    const codes = new Set(codesOf(settings?.structure_owns_sources));
    return {
      describe: `products stocked in ${codes.size ? [...codes].join(", ") : "no source (the setting is blank)"}`,
      mode,
      owns: (product) =>
        (product.sourceCodes ?? []).some((code) => codes.has(code)),
    };
  }
  if (mode === OWNS.ATTRIBUTE) {
    const attribute = attributeOf(settings?.structure_owns_attribute);
    return {
      describe: attribute
        ? `products whose ${attribute.code} is ${attribute.value}`
        : "products whose attribute names this ERP (the setting is blank)",
      mode,
      owns: (product) =>
        Boolean(attribute) &&
        String(product.customAttributes?.[attribute.code] ?? "") ===
          attribute.value,
    };
  }
  return { describe: "every product", mode: OWNS.ALL, owns: () => true };
}

/**
 * Does this ERP own a SKU, asked of Commerce (a product or stock event names a SKU and
 * little else). `all` answers without a read.
 * @param {object} readers `{ sourceCodesOf(params, sku), productAttributes(params, sku) }`
 */
export async function ownsSku(params, sku, settings, readers) {
  const filter = ownershipFilter(settings);
  if (filter.mode === OWNS.ALL) {
    return true;
  }
  if (filter.mode === OWNS.SOURCES) {
    return filter.owns({
      sourceCodes: await readers.sourceCodesOf(params, sku),
    });
  }
  return filter.owns({
    customAttributes: await readers.productAttributes(params, sku),
  });
}

/**
 * The structure block the full mirror sends the ERP (contract `import.structure`):
 * Commerce's websites, each with the sales organisation its setting names and what the
 * store configuration says about it. Store Information (address, VAT) is not readable
 * over REST (composite-entity research, 2026-09-24), so those stay null here and the
 * ERP's Organisation card says so.
 * @param {Array<{id:number, code:string, name:string}>} websites
 * @param {Map<number, {currency:string|null, locale:string|null}>} configs by website id
 * @param {Map<number, object>} settingsByWebsite the website-scoped settings, by website id
 */
export function structureFrom(websites, configs, settingsByWebsite) {
  return {
    websites: websites.map((site) => {
      const settings = settingsByWebsite.get(site.id) ?? {};
      const config = configs.get(site.id) ?? {};
      const locale = typeof config.locale === "string" ? config.locale : "";
      const { salesOrg, salesOrgName } = salesOrgOf(settings);
      return {
        code: site.code,
        name: site.name,
        salesOrg,
        salesOrgName: salesOrgName ?? null,
        storeInfo: {
          address: null,
          countryId: locale.includes("_") ? locale.split("_")[1] : null,
          currency: config.currency ?? null,
          vatNumber: null,
        },
      };
    }),
  };
}
