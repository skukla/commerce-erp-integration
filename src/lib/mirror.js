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

/**
 * Read Commerce and import into the ERP.
 * @param {object} readers `{ listProducts, listStock, listCompanies }` each `async (params)`
 * @param {object} erp the ERP client (`importRecords`)
 * @returns {Promise<{ products: object, partners: object, counts: object }>}
 */
export async function mirror(params, readers, erp, projectName) {
  const [products, stock, companies] = await Promise.all([
    readers.listProducts(params),
    readers.listStock(params),
    readers.listCompanies(params),
  ]);
  const productRows = productsFrom(products, stock);
  const partners = partnersFrom(companies);
  const result = await erp.importRecords(params, {
    partners,
    products: productRows,
    projectName,
  });
  if (!result.ok) {
    throw new Error(
      `ERP import answered ${result.status}: ${result.data?.errorMessage || "unknown error"}`,
    );
  }
  return {
    counts: { companies: companies.length, products: products.length },
    partners: result.data.partners,
    products: result.data.products,
  };
}
