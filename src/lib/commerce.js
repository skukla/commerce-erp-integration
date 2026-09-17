/*
 * The Commerce REST calls this integration makes beyond the kit's own clients. The
 * client comes from @adobe/aio-commerce-lib-app: base URL and flavour from the App
 * Management association record, auth from the injected IMS credential.
 */
import { getCommerceClient } from "@adobe/aio-commerce-lib-app";
import { resolveImsAuthParams } from "@adobe/aio-commerce-sdk/auth";

/** Company status values Commerce uses. */
export const COMPANY_STATUS = {
  APPROVED: 1,
  BLOCKED: 3,
  PENDING: 0,
  REJECTED: 2,
};

const PAGE_SIZE = 100;

/** @returns {Promise<import("@adobe/aio-commerce-lib-api/commerce").AdobeCommerceHttpClient>} */
export function commerceClient(params) {
  return getCommerceClient(resolveImsAuthParams(params));
}

function searchParams(page, pageSize, extra = {}) {
  return {
    "searchCriteria[currentPage]": String(page),
    "searchCriteria[pageSize]": String(pageSize),
    ...extra,
  };
}

/**
 * Read every page of a search endpoint.
 * @param {object} client the Commerce client
 * @param {string} path e.g. "products"
 * @param {object} [extra] extra search-criteria query params
 * @returns {Promise<object[]>} the items
 */
export async function readAllPages(client, path, extra = {}) {
  const items = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (items.length < total) {
    // Pages must be sequential: total_count arrives with the first one.
    // biome-ignore lint/performance/noAwaitInLoops: sequential paging
    const data = await client
      .get(path, { searchParams: searchParams(page, PAGE_SIZE, extra) })
      .json();
    const batch = data.items ?? [];
    items.push(...batch);
    total = Number(data.total_count ?? items.length);
    if (batch.length === 0) {
      break;
    }
    page += 1;
  }
  return items;
}

/** Products, minimal fields. */
export async function listProducts(params) {
  const client = await commerceClient(params);
  const items = await readAllPages(client, "products", {
    "searchCriteria[filter_groups][0][filters][0][field]": "status",
    "searchCriteria[filter_groups][0][filters][0][value]": "1",
  });
  return items.map((p) => ({
    listPrice: Number(p.price ?? 0),
    name: p.name,
    sku: p.sku,
    typeId: p.type_id,
  }));
}

/**
 * Stock per SKU, per inventory source (Commerce multi-source inventory): each SKU maps
 * to `[{ code, quantity }]`, one row per source it is assigned to. The ERP calls a
 * source a warehouse and edits each one on its own.
 */
export async function listStock(params) {
  const client = await commerceClient(params);
  const items = await readAllPages(client, "inventory/source-items");
  const bySku = new Map();
  for (const item of items) {
    const rows = bySku.get(item.sku) ?? [];
    rows.push({
      code: item.source_code,
      quantity: Math.max(0, Math.round(Number(item.quantity ?? 0))),
    });
    bySku.set(item.sku, rows);
  }
  return bySku;
}

/**
 * Inventory source names by code. A store without the sources API answers an empty
 * map, and each warehouse is then named by its code.
 */
export async function listSources(params) {
  const client = await commerceClient(params);
  let sources;
  try {
    sources = await readAllPages(client, "inventory/sources");
  } catch (error) {
    if (error.response?.status === 404) {
      return new Map();
    }
    throw error;
  }
  return new Map(sources.map((source) => [source.source_code, source.name]));
}

/** B2B companies with their credit records; an instance without B2B answers an empty list. */
export async function listCompanies(params) {
  const client = await commerceClient(params);
  let companies;
  try {
    companies = await readAllPages(client, "company");
  } catch (error) {
    if (error.response?.status === 404) {
      return [];
    }
    throw error;
  }
  const out = [];
  for (const company of companies) {
    let credit = null;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one credit record per company
      credit = await client.get(`companyCredits/company/${company.id}`).json();
    } catch {
      credit = null;
    }
    out.push({
      blocked: Number(company.status) === COMPANY_STATUS.BLOCKED,
      creditId: credit?.id ?? null,
      creditLimit: credit ? Number(credit.credit_limit ?? 0) : null,
      customerGroupId: company.customer_group_id,
      email: company.company_email ?? null,
      id: company.id,
      name: company.company_name,
      status: company.status,
    });
  }
  return out;
}

/** @returns {Promise<string|null>} the SKU of a product id, null when unknown */
export async function skuForProductId(params, productId) {
  const client = await commerceClient(params);
  const data = await client
    .get("products", {
      searchParams: {
        "searchCriteria[filter_groups][0][filters][0][field]": "entity_id",
        "searchCriteria[filter_groups][0][filters][0][value]":
          String(productId),
        "searchCriteria[pageSize]": "1",
      },
    })
    .json();
  return data.items?.[0]?.sku ?? null;
}

/** @returns {Promise<object>} the company */
export async function getCompany(params, companyId) {
  const client = await commerceClient(params);
  return client.get(`company/${companyId}`).json();
}

/** @returns {Promise<object>} the credit record */
export async function getCompanyCredit(params, companyId) {
  const client = await commerceClient(params);
  return client.get(`companyCredits/company/${companyId}`).json();
}

/** Set a company's status (blocked = 3, approved = 1). */
export async function setCompanyStatus(params, companyId, status) {
  const client = await commerceClient(params);
  return client
    .put(`company/${companyId}`, {
      json: { company: { id: companyId, status } },
    })
    .json();
}

/** Set a company's credit limit. */
export async function setCompanyCreditLimit(
  params,
  creditId,
  companyId,
  creditLimit,
) {
  const client = await commerceClient(params);
  return client
    .put(`companyCredits/${creditId}`, {
      json: {
        creditLimit: {
          company_id: companyId,
          credit_limit: creditLimit,
          id: creditId,
        },
      },
    })
    .json();
}

/** Set a product's price. */
export async function setProductPrice(params, sku, price) {
  const client = await commerceClient(params);
  return client
    .put(`products/${encodeURIComponent(sku)}`, {
      json: { product: { price, sku } },
    })
    .json();
}

/** Set a SKU's quantity on the default source. */
export async function setStock(params, sku, quantity, sourceCode = "default") {
  const client = await commerceClient(params);
  return client
    .post("inventory/source-items", {
      json: {
        sourceItems: [
          {
            quantity,
            sku,
            source_code: sourceCode,
            status: quantity > 0 ? 1 : 0,
          },
        ],
      },
    })
    .json();
}

/**
 * Clear the external order id the ERP put on an order (a sparse order save: entity id plus
 * the one field). Reset and detach use it so no Commerce order keeps a number the ERP no
 * longer has. Notes in the order history cannot be removed and stay.
 */
export async function clearExtOrderId(params, orderId) {
  const client = await commerceClient(params);
  return client
    .post("orders", {
      json: { entity: { entity_id: Number(orderId), ext_order_id: "" } },
    })
    .json();
}

/** Order operations the ERP's statuses map to. */
export const orders = {
  cancel: async (params, orderId) =>
    (await commerceClient(params)).post(`orders/${orderId}/cancel`).json(),
  comment: async (params, orderId, comment, status) =>
    (await commerceClient(params))
      .post(`orders/${orderId}/comments`, {
        json: {
          statusHistory: {
            comment,
            is_customer_notified: 0,
            is_visible_on_front: 1,
            ...(status ? { status } : {}),
          },
        },
      })
      .json(),
  get: async (params, orderId) =>
    (await commerceClient(params)).get(`orders/${orderId}`).json(),
  invoice: async (params, orderId) =>
    (await commerceClient(params))
      .post(`order/${orderId}/invoice`, {
        json: { capture: true, notify: false },
      })
      .json(),
  ship: async (params, orderId, items, comment) =>
    (await commerceClient(params))
      .post(`order/${orderId}/ship`, {
        json: {
          comment: { comment, is_visible_on_front: 1 },
          items,
          notify: false,
        },
      })
      .json(),
};
