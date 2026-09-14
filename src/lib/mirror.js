/*
 * Mirror Commerce into the ERP: products become materials, B2B companies become
 * business partners (decision 3). Pure over the readers it is handed, so it is tested
 * without either system.
 */

/** @returns {object[]} ERP material rows */
export function materialsFrom(products, stockBySku) {
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
 * Read Commerce and import into the ERP.
 * @param {object} readers `{ listProducts, listStock, listCompanies }` each `async (params)`
 * @param {object} erp the ERP client (`importRecords`)
 * @returns {Promise<{ materials: object, partners: object, counts: object }>}
 */
export async function mirror(params, readers, erp, projectName) {
  const [products, stock, companies] = await Promise.all([
    readers.listProducts(params),
    readers.listStock(params),
    readers.listCompanies(params),
  ]);
  const materials = materialsFrom(products, stock);
  const partners = partnersFrom(companies);
  const result = await erp.importRecords(params, {
    materials,
    partners,
    projectName,
  });
  if (!result.ok) {
    throw new Error(
      `ERP import answered ${result.status}: ${result.data?.errorMessage || "unknown error"}`,
    );
  }
  return {
    counts: { companies: companies.length, products: products.length },
    materials: result.data.materials,
    partners: result.data.partners,
  };
}
