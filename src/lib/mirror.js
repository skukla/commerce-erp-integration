/*
 * Mirror Commerce into the ERP: products become products, B2B companies become
 * business partners (decision 3). Pure over the readers it is handed, so it is tested
 * without either system.
 */

/** @returns {object[]} ERP product rows */
export function productsFrom(products, stockBySku) {
  return products
    .filter((p) => p.sku)
    .map((p) => ({
      listPrice: p.listPrice,
      name: p.name || p.sku,
      sku: p.sku,
      stock: stockBySku?.get ? (stockBySku.get(p.sku) ?? 0) : 0,
    }));
}

/** @returns {object[]} ERP business-partner rows; ids are `C<companyId>` */
export function partnersFrom(companies) {
  return companies.map((c) => ({
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
    name: c.name,
  }));
}

/**
 * Refresh only the business partners from Commerce (cheap: a handful of companies). The
 * refresh-partners action runs it every minute so a company the SC creates or edits while preparing the demo
 * reaches the ERP without a reset.
 */
export async function mirrorPartners(params, readers, erp) {
  const companies = await readers.listCompanies(params);
  const partners = partnersFrom(companies);
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

/** Products per import request: keeps each request well under Runtime's 1 MB limit. */
export const PRODUCT_BATCH = 200;

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
 * @param {object} readers `{ listProducts, listStock, listCompanies }` each `async (params)`
 * @param {object} erp the ERP client (`importRecords`)
 * @param {(step: object) => Promise<void>} [report] receives `{ state, phase, partners, products }`
 * @returns {Promise<{ products: object, partners: object, counts: object }>}
 */
export async function mirror(
  params,
  readers,
  erp,
  projectName,
  report = noReport,
) {
  await report({ phase: "reading", state: "running" });
  const [products, stock, companies] = await Promise.all([
    readers.listProducts(params),
    readers.listStock(params),
    readers.listCompanies(params),
  ]);
  const productRows = productsFrom(products, stock);
  const partners = partnersFrom(companies);
  const partnerTotal = partners.length;
  const productTotal = productRows.length;

  await report({
    partners: { done: 0, total: partnerTotal },
    phase: "partners",
    products: { done: 0, total: productTotal },
    state: "running",
  });
  const partnerResult = importOrThrow(
    await erp.importRecords(params, { partners, projectName }),
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
    counts: { companies: companies.length, products: products.length },
    partners: partnerResult.partners,
    products: productResult,
  };
}
