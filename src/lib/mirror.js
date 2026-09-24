/*
 * Mirror Commerce into the ERP: products become products, B2B companies become
 * business partners (decision 3). Pure over the readers it is handed, so it is tested
 * without either system.
 */

import { ownershipFilter, salesOrgOf, structureFrom } from "#lib/structure";

function warehousesFor(sku, stockBySku, sourceNames) {
  return (stockBySku?.get?.(sku) ?? []).map((row) => ({
    code: row.code,
    name: sourceNames.get(row.code) || row.code,
    quantity: row.quantity,
  }));
}

/** "Silver · 128GB"-style values of a variant, in the order its parent lists them. */
function variantValues(product, parent, attributes) {
  return parent.optionAttributeIds.map((id) => {
    const attribute = attributes.get(id);
    const raw = attribute
      ? product.customAttributes?.[attribute.code]
      : undefined;
    return {
      label: attribute?.label ?? id,
      value:
        raw === undefined || raw === null
          ? ""
          : (attribute.options.get(String(raw)) ?? String(raw)),
    };
  });
}

/**
 * ERP product rows. A configurable product becomes a parent with no stock of its
 * own (in Commerce, stock lives on its variants); each of its variants carries
 * `parentSku` and the values it varies on. Every other product carries its
 * warehouses: one per inventory source the SKU is assigned to, named from the
 * store's sources (or by code when the name is unknown).
 * @param {Map<string, Array<{code: string, quantity: number}>>} stockBySku
 * @param {Map<string, string>} [sourceNames]
 * @param {Map<string, object>} [attributes] from listVariantAttributes
 * @returns {object[]}
 */
export function productsFrom(
  products,
  stockBySku,
  sourceNames = new Map(),
  attributes = new Map(),
) {
  const withSku = products.filter((p) => p.sku);
  const byId = new Map(withSku.map((p) => [p.id, p]));
  const parentOf = new Map();
  for (const p of withSku) {
    if (p.typeId !== "configurable") {
      continue;
    }
    for (const childId of p.childIds ?? []) {
      if (byId.has(childId)) {
        parentOf.set(childId, p);
      }
    }
  }
  return withSku.map((p) => {
    const row = { listPrice: p.listPrice, name: p.name || p.sku, sku: p.sku };
    if (p.typeId === "configurable") {
      return { ...row, type: "configurable", warehouses: [] };
    }
    const parent = parentOf.get(p.id);
    return {
      ...row,
      ...(parent
        ? {
            parentSku: parent.sku,
            variantAttributes: variantValues(p, parent, attributes),
          }
        : {}),
      type: "simple",
      warehouses: warehousesFor(p.sku, stockBySku, sourceNames),
    };
  });
}

/**
 * ERP business-partner rows; ids are `C<companyId>`. With the websites and each website's
 * sales organisation (business structure), a company's admin website names the sales
 * organisation it buys through; a company with no admin website belongs to none yet.
 * @param {Array<{id:number, code:string}>} [websites]
 * @param {Map<number, string>} [salesOrgByWebsite] website id → sales organisation code
 * @returns {object[]}
 */
export function partnersFrom(
  companies,
  websites = [],
  salesOrgByWebsite = new Map(),
) {
  const siteById = new Map(websites.map((site) => [site.id, site]));
  return companies.map((c) => {
    const site =
      c.websiteId === undefined || c.websiteId === null
        ? null
        : siteById.get(Number(c.websiteId));
    return {
      blocked: Boolean(c.blocked),
      commerceCompanyId: String(c.id),
      creditLimit: c.creditLimit ?? undefined,
      customerGroupId:
        c.customerGroupId === undefined || c.customerGroupId === null
          ? undefined
          : String(c.customerGroupId),
      emailDomain: c.email?.includes("@")
        ? c.email.split("@")[1].toLowerCase()
        : undefined,
      id: `C${c.id}`,
      legalAddress: c.legalAddress ?? null,
      legalName: c.legalName ?? null,
      name: c.name,
      resellerId: c.resellerId ?? null,
      salesOrgs: site ? [salesOrgByWebsite.get(site.id) ?? "1000"] : [],
      vatTaxId: c.vatTaxId ?? null,
      website: site ? { code: site.code, id: site.id } : null,
    };
  });
}

/**
 * The websites, each website's settings and the structure block, read once per mirror.
 * Readers without `listWebsites` (older tests, a store that refuses the read) get an
 * empty structure and partners in no sales organisation.
 */
async function readStructure(params, readers) {
  if (!readers.listWebsites) {
    return { salesOrgByWebsite: new Map(), structure: null, websites: [] };
  }
  const [websites, configs] = await Promise.all([
    readers.listWebsites(params),
    readers.storeConfigs ? readers.storeConfigs(params) : new Map(),
  ]);
  const settingsByWebsite = new Map();
  if (readers.websiteSettings) {
    for (const site of websites) {
      // biome-ignore lint/performance/noAwaitInLoops: a handful of websites, read in order
      settingsByWebsite.set(site.id, await readers.websiteSettings(site.code));
    }
  }
  const salesOrgByWebsite = new Map(
    websites.map((site) => [
      site.id,
      salesOrgOf(settingsByWebsite.get(site.id)).salesOrg,
    ]),
  );
  return {
    salesOrgByWebsite,
    structure: structureFrom(websites, configs, settingsByWebsite),
    websites,
  };
}

/**
 * Refresh only the business partners from Commerce (cheap: a handful of companies). The
 * refresh-partners action runs it every minute so a company the SC creates or edits while preparing the demo
 * reaches the ERP without a reset.
 */
export async function mirrorPartners(params, readers, erp) {
  const [companies, { websites, salesOrgByWebsite }] = await Promise.all([
    readers.listCompanies(params),
    readStructure(params, readers),
  ]);
  const partners = partnersFrom(companies, websites, salesOrgByWebsite);
  // No products key at all: the ERP's last-import time means a full mirror, and a
  // partners-only import must not move it.
  const result = await erp.importRecords(params, { partners });
  if (!result.ok) {
    throw new Error(
      `ERP import answered ${result.status}: ${result.data?.errorMessage || "unknown error"}`,
    );
  }
  return { companies: companies.length, partners: result.data.partners };
}

/**
 * Products per import request.
 *
 * Small on purpose since 2026-09-17: the ERP's screen shows the count imported
 * so far, and one report per batch means the number only moves once per batch.
 * At 200 a typical demo catalogue (Bodea: 182) was a single batch, so the bar
 * went from nothing to finished with nothing in between. 25 gives a catalogue
 * that size eight steps, at the cost of a few more requests.
 *
 * Also keeps each request well under Runtime's 1 MB limit, which is why it was
 * ever capped.
 */
export const PRODUCT_BATCH = 25;

function importOrThrow(result) {
  if (!result.ok) {
    throw new Error(
      `ERP import answered ${result.status}: ${result.data?.errorMessage || "unknown error"}`,
    );
  }
  return result.data;
}

function batches(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  // An empty catalog still sends one products import, which is what stamps the
  // ERP's last full import.
  return out.length > 0 ? out : [[]];
}

const noReport = () => Promise.resolve();

/**
 * Read Commerce and import into the ERP, reporting each step to `report` (the ERP's
 * sync record): reading, then partners, then products batch by batch.
 * @param {object} readers `{ listProducts, listStock, listCompanies, listSources?, listVariantAttributes?, listWebsites?, storeConfigs?, websiteSettings? }`
 * @param {object} erp the ERP client (`importRecords`)
 * @param {(step: object) => Promise<void>} [report] receives `{ state, phase, partners, products }`
 * @param {object} [settings] the pair's settings (Default Config): which products belong to this ERP
 * @returns {Promise<{ products: object, partners: object, counts: object }>}
 */
export async function mirror(
  params,
  readers,
  erp,
  projectName,
  report = noReport,
  settings = {},
) {
  await report({ phase: "reading", state: "running" });
  const [products, stock, companies, sourceNames, structureRead] =
    await Promise.all([
      readers.listProducts(params),
      readers.listStock(params),
      readers.listCompanies(params),
      readers.listSources ? readers.listSources(params) : new Map(),
      readStructure(params, readers),
    ]);
  const { websites, salesOrgByWebsite, structure } = structureRead;
  const attributeIds = [
    ...new Set(products.flatMap((p) => p.optionAttributeIds ?? [])),
  ];
  const attributes =
    readers.listVariantAttributes && attributeIds.length > 0
      ? await readers.listVariantAttributes(params, attributeIds)
      : new Map();
  // Which products belong to this ERP (rule M3): the rest are another ERP's and stay out.
  const filter = ownershipFilter(settings);
  const owned = products.filter((p) =>
    filter.owns({
      customAttributes: p.customAttributes,
      sourceCodes: (stock.get(p.sku) ?? []).map((row) => row.code),
    }),
  );
  const skipped = products.length - owned.length;
  const productRows = productsFrom(owned, stock, sourceNames, attributes);
  const partners = partnersFrom(companies, websites, salesOrgByWebsite);
  const partnerTotal = partners.length;
  const productTotal = productRows.length;

  await report({
    partners: { done: 0, total: partnerTotal },
    phase: "partners",
    products: { done: 0, total: productTotal },
    state: "running",
  });
  // The structure block rides with the partners import: the full mirror is the one
  // place Commerce's websites and their sales organisations reach the ERP (contract v2).
  const partnerResult = importOrThrow(
    await erp.importRecords(params, {
      partners,
      projectName,
      ...(structure ? { structure } : {}),
    }),
  );

  const productResult = { created: 0, updated: 0 };
  let done = 0;
  await report({
    partners: { done: partnerTotal, total: partnerTotal },
    phase: "products",
    products: { done, total: productTotal },
    state: "running",
  });
  for (const batch of batches(productRows, PRODUCT_BATCH)) {
    // Sequential on purpose: the count a screen shows is the count imported so far.
    // biome-ignore lint/performance/noAwaitInLoops: ordered, reported batches
    const response = await erp.importRecords(params, { products: batch });
    const data = importOrThrow(response);
    productResult.created += data.products?.created ?? 0;
    productResult.updated += data.products?.updated ?? 0;
    done += batch.length;
    await report({
      phase: "products",
      products: { done, total: productTotal },
      state: "running",
    });
  }
  return {
    counts: {
      companies: companies.length,
      products: products.length,
      skipped,
      ...(skipped ? { owns: filter.describe } : {}),
    },
    partners: partnerResult.partners,
    products: productResult,
  };
}
