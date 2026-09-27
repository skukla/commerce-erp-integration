/*
 * The box's stand-in for Demo Builder's fill (AB-26y): Demo Builder, not the integration,
 * copies Commerce into the ERP now (its erpFill.ts / erpFillRows.ts). The journeys need an
 * ERP that already holds the store, so this imports the fake Commerce's companies and
 * products through the ERP's ordinary import, the way that fill does.
 *
 * productsFrom is a copy of the rules erpFillRows.ts carries (it was the integration's
 * lib/mirror.js until that was removed); partners come from the integration's own
 * partnersFrom, which the company event uses. Test-only: nothing in src/ calls this.
 */
import { partnersFrom } from "#lib/company-sync";
import { replaceKeyMap } from "#lib/key-map";

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
function productsFrom(
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
 * Fill the ERP from the fake Commerce: partners first, then products.
 * @param {object} readers the fake Commerce's reads (`box.commerce.lib`)
 * @param {object} erp the integration's ERP client, pointed at the in-process ERP
 */
export async function fillErp(readers, erp, projectName) {
  const [products, stock, companies, sourceNames, websites] = await Promise.all(
    [
      readers.listProducts({}),
      readers.listStock({}),
      readers.listCompanies({}),
      readers.listSources({}),
      readers.listWebsites({}),
    ],
  );
  const partners = partnersFrom(companies, websites);
  for (const body of [
    { partners, projectName },
    { products: productsFrom(products, stock, sourceNames) },
  ]) {
    // biome-ignore lint/performance/noAwaitInLoops: partners before products, as the fill sends them
    const res = await erp.importRecords({}, body);
    if (!res.ok) {
      throw new Error(`ERP import answered ${res.status}`);
    }
  }
  // Last, as Demo Builder does: which Commerce company is which ERP customer. The partner
  // rows carry no Commerce id (contract version 3), so the pairs come from the companies.
  await replaceKeyMap(
    companies.map((company, index) => ({
      commerce: String(company.id),
      erp: partners[index].id,
      kind: "customer",
    })),
  );
}
