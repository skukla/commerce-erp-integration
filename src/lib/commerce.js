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

/**
 * How long one Commerce call may take. The library's own default is ky's ten seconds,
 * and this sandbox exceeds it routinely: on 2026-09-25 the write-back of an ERP number
 * timed out at ten seconds (and landed anyway, so the run was logged as failed and
 * delivered again), and every credit-hold delivery for the same order failed the same
 * way. Thirty seconds sits under the event actions' 60-second Runtime limit with room
 * for the ERP call beside it. The kit's own clients (actions/../commerce-*-api-client.js)
 * take the same options.
 */
export const COMMERCE_TIMEOUT_MS = 30_000;
/** The fetch options every Commerce client here is built with. */
export const COMMERCE_FETCH_OPTIONS = { timeout: COMMERCE_TIMEOUT_MS };

/** @returns {Promise<import("@adobe/aio-commerce-lib-api/commerce").AdobeCommerceHttpClient>} */
export function commerceClient(params) {
  return getCommerceClient(
    resolveImsAuthParams(params),
    COMMERCE_FETCH_OPTIONS,
  );
}

/**
 * The Commerce company a customer belongs to, as a string, or null for a customer with
 * none. The order event names the customer and the customer group but not the company,
 * and the group cannot name the company: Commerce puts every company in General unless a
 * shared catalog gives it a group of its own (measured 2026-09-25: three companies on
 * group 1, an order booked to the wrong one).
 */
export async function customerCompanyId(params, customerId) {
  const client = await commerceClient(params);
  const customer = await client.get(`customers/${Number(customerId)}`).json();
  const companyId =
    customer?.extension_attributes?.company_attributes?.company_id;
  return companyId === undefined || companyId === null
    ? null
    : String(companyId);
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

/** The company's credit record, or null when it has none (or the read fails). */
async function creditOf(client, companyId) {
  try {
    return await client.get(`companyCredits/company/${companyId}`).json();
  } catch {
    return null;
  }
}

/**
 * The company admin's website id, or null. The admin's website is the buyer's sales
 * organization (business structure): `website_id` is documented on the customer object.
 */
async function adminWebsiteOf(client, company) {
  if (!company.super_user_id) {
    return null;
  }
  try {
    const admin = await client.get(`customers/${company.super_user_id}`).json();
    return admin?.website_id === undefined || admin.website_id === null
      ? null
      : Number(admin.website_id);
  } catch {
    return null;
  }
}

/** One company as the ERP needs it: credit, legal identity (read 2026-09-24), admin website. */
async function companyRow(client, company) {
  const [credit, websiteId] = await Promise.all([
    creditOf(client, company.id),
    adminWebsiteOf(client, company),
  ]);
  return {
    blocked: Number(company.status) === COMPANY_STATUS.BLOCKED,
    creditId: credit?.id ?? null,
    creditLimit: credit ? Number(credit.credit_limit ?? 0) : null,
    customerGroupId: company.customer_group_id,
    email: company.company_email ?? null,
    id: company.id,
    legalAddress: legalAddressOf(company),
    legalName: company.legal_name ?? null,
    name: company.company_name,
    resellerId: company.reseller_id ?? null,
    status: company.status,
    vatTaxId: company.vat_tax_id ?? null,
    websiteId,
  };
}

/** One company as the ERP needs it, read by id (a company event carries only the id to rely on). */
export async function readCompanyRow(params, companyId) {
  const client = await commerceClient(params);
  const company = await client.get(`company/${Number(companyId)}`).json();
  return companyRow(client, company);
}

/** The company's legal address from the company object's own fields, or null when it has none. */
function legalAddressOf(company) {
  let street = [];
  if (Array.isArray(company.street)) {
    street = company.street.filter(Boolean);
  } else if (company.street) {
    street = [String(company.street)];
  }
  const address = {
    city: company.city ?? null,
    countryId: company.country_id ?? null,
    postcode: company.postcode ?? null,
    region: company.region ?? null,
    street,
    telephone: company.telephone ?? null,
  };
  const empty =
    street.length === 0 &&
    !address.city &&
    !address.countryId &&
    !address.postcode &&
    !address.region &&
    !address.telephone;
  return empty ? null : address;
}

/**
 * Commerce's websites (`GET store/websites`, read-only on every platform), without the
 * Admin website, whose codes collide with store codes in the config store.
 * @returns {Promise<Array<{ id: number, code: string, name: string }>>}
 */
export async function listWebsites(params) {
  const client = await commerceClient(params);
  const sites = await client.get("store/websites").json();
  return (sites ?? [])
    .filter((site) => site.code !== "admin")
    .map((site) => ({ code: site.code, id: Number(site.id), name: site.name }));
}

const websiteOfStore = new Map();

/**
 * The code of the website a store view belongs to: an order carries its store view, and an
 * ERP's sales organization can be set per website (lib/erp-settings.js). Read once per
 * activation for all store views.
 * @returns {Promise<string|undefined>}
 */
export async function websiteCodeOfStore(params, storeId) {
  if (websiteOfStore.size === 0) {
    const client = await commerceClient(params);
    const [views, websites] = await Promise.all([
      client.get("store/storeViews").json(),
      listWebsites(params),
    ]);
    const codeById = new Map(websites.map((site) => [site.id, site.code]));
    for (const view of views ?? []) {
      websiteOfStore.set(
        Number(view.id),
        codeById.get(Number(view.website_id)),
      );
    }
  }
  return websiteOfStore.get(Number(storeId));
}

/** The inventory sources one SKU is assigned to (for the ownership check on an event). */
export async function sourceCodesOf(params, sku) {
  const client = await commerceClient(params);
  const items = await readAllPages(client, "inventory/source-items", {
    "searchCriteria[filter_groups][0][filters][0][field]": "sku",
    "searchCriteria[filter_groups][0][filters][0][value]": String(sku),
  });
  return items.map((item) => item.source_code);
}

/**
 * One SKU's stock at every inventory source it is assigned to, each named from the store's
 * sources: what the ERP is told when a product or its stock item is saved. Commerce raises
 * no event for a quantity at a source (read in its events reference, 2026-09-27), and the
 * stock item it does raise one for is the default source only, so an event about a product
 * is the cue to read all of them.
 * @returns {Promise<Array<{ code: string, name: string, quantity: number }>>}
 */
export async function warehousesOfSku(params, sku) {
  const client = await commerceClient(params);
  const [items, names] = await Promise.all([
    readAllPages(client, "inventory/source-items", {
      "searchCriteria[filter_groups][0][filters][0][field]": "sku",
      "searchCriteria[filter_groups][0][filters][0][value]": String(sku),
    }),
    listSources(params),
  ]);
  return items.map((item) => ({
    code: item.source_code,
    name: names.get(item.source_code) || item.source_code,
    quantity: Math.max(0, Math.round(Number(item.quantity ?? 0))),
  }));
}

/** The SKUs of these product ids (a mass action hands the grid's entity ids). */
export async function skusForProductIds(params, productIds) {
  const client = await commerceClient(params);
  const items = await readAllPages(client, "products", {
    "searchCriteria[filter_groups][0][filters][0][condition_type]": "in",
    "searchCriteria[filter_groups][0][filters][0][field]": "entity_id",
    "searchCriteria[filter_groups][0][filters][0][value]": productIds.join(","),
  });
  return items.map((product) => product.sku);
}

/**
 * Move all of each SKU's stock from one source to another, taking the origin off the
 * product (Commerce's Transfer Inventory To Source with "unassign the origin").
 */
export async function transferAllStock(params, skus, from, to) {
  const client = await commerceClient(params);
  return client
    .post("inventory/bulk-product-source-transfer", {
      json: {
        destinationSource: to,
        originSource: from,
        skus,
        unassignFromOrigin: true,
      },
    })
    .json();
}

/** Move a quantity of each SKU from one source to another; the origin stays assigned. */
export async function transferSomeStock(params, items, from, to) {
  const client = await commerceClient(params);
  return client
    .post("inventory/bulk-partial-source-transfer", {
      json: {
        destinationSourceCode: to,
        items,
        originSourceCode: from,
      },
    })
    .json();
}

/** One product's custom attributes, code → value (for the ownership check on an event). */
export async function productAttributes(params, sku) {
  const client = await commerceClient(params);
  const product = await client
    .get(`products/${encodeURIComponent(sku)}`)
    .json();
  return Object.fromEntries(
    (product?.custom_attributes ?? []).map((a) => [a.attribute_code, a.value]),
  );
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

/**
 * A configurable product's SKU and its variants' SKUs, from the product id an order line
 * carries (the router's variant check, router/route-order.js).
 * @returns {Promise<{ parentSku: string|null, skus: string[] }>}
 */
export async function variantsOfProduct(params, productId) {
  const parentSku = await skuForProductId(params, productId);
  if (!parentSku) {
    return { parentSku: null, skus: [] };
  }
  const client = await commerceClient(params);
  const children = await client
    .get(`configurable-products/${encodeURIComponent(parentSku)}/children`)
    .json();
  return { parentSku, skus: (children ?? []).map((child) => child.sku) };
}

/** @returns {Promise<object|null>} the product by SKU, or null when Commerce has none */
export async function getProduct(params, sku) {
  const client = await commerceClient(params);
  try {
    return await client.get(`products/${encodeURIComponent(sku)}`).json();
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
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

/**
 * Set a company's status (blocked = 3, approved = 1). Commerce's company PUT is a
 * whole-record write: a body of only `{id, status}` is refused ("No such entity with
 * customerGroupId = null", measured 2026-09-24 on ACCS), so the company is read first
 * and written back with the one field changed.
 */
export async function setCompanyStatus(params, companyId, status) {
  const client = await commerceClient(params);
  const company = await client.get(`company/${companyId}`).json();
  return client
    .put(`company/${companyId}`, {
      json: { company: { ...company, id: companyId, status } },
    })
    .json();
}

/**
 * Replace a company's custom attributes with this set (the per-ERP credit attributes,
 * lib/erp-credit.js). Written whole: the REST call may replace the set.
 */
export async function setCompanyCustomAttributes(
  params,
  companyId,
  attributes,
) {
  const client = await commerceClient(params);
  return client
    .post("company/setCustomAttributes", {
      json: { company_id: String(companyId), custom_attributes: attributes },
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
  // Commerce refuses the write without the record's currency ("currency_code is
  // required", measured 2026-09-24 on ACCS): the ERP's credit event and detach's
  // revert both failed with 400 until the currency travelled with the limit. Read
  // it from the record rather than assume a store's base currency.
  const current = await client.get(`companyCredits/${creditId}`).json();
  return client
    .put(`companyCredits/${creditId}`, {
      json: {
        creditLimit: {
          company_id: companyId,
          credit_limit: creditLimit,
          currency_code: current.currency_code,
          id: creditId,
        },
      },
    })
    .json();
}

/** Set a product's price. */
/** Set a SKU's name. The counterpart of the name the ERP's product event writes. */
export async function setProductName(params, sku, name) {
  const client = await commerceClient(params);
  return client
    .put(`products/${encodeURIComponent(sku)}`, {
      json: { product: { name, sku } },
    })
    .json();
}

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
 * Put the ERP's order number on a Commerce order as `ext_order_id` (a sparse order save:
 * entity id plus the one field). An empty value clears it.
 */
export async function setExtOrderId(params, orderId, value) {
  const client = await commerceClient(params);
  return client
    .post("orders", {
      json: { entity: { entity_id: Number(orderId), ext_order_id: value } },
    })
    .json();
}

/**
 * Clear the external order id the ERP put on an order. Reset and detach use it so no
 * Commerce order keeps a number the ERP no longer has. Notes in the order history cannot
 * be removed and stay.
 */
export function clearExtOrderId(params, orderId) {
  return setExtOrderId(params, orderId, "");
}

/**
 * The whole order with this increment id (the number a shopper sees), or null. What the
 * Admin screen's Retry sends again: the event that first carried the order is gone.
 * @returns {Promise<object|null>}
 */
export async function getOrderByIncrementId(params, incrementId) {
  const client = await commerceClient(params);
  const data = await client
    .get("orders", {
      searchParams: searchParams(1, 1, {
        "searchCriteria[filter_groups][0][filters][0][field]": "increment_id",
        "searchCriteria[filter_groups][0][filters][0][value]":
          String(incrementId),
      }),
    })
    .json();
  return data.items?.[0] ?? null;
}

/**
 * The order with this increment id, or null: the ids a write needs. The order save event
 * carries the increment id but not the entity id the order endpoints take.
 * @returns {Promise<{ entityId: number, extOrderId: string|null, storeId: number }|null>}
 */
export async function findOrderByIncrementId(params, incrementId) {
  const order = await getOrderByIncrementId(params, incrementId);
  if (!order) {
    return null;
  }
  return {
    entityId: Number(order.entity_id),
    extOrderId: order.ext_order_id || null,
    storeId: Number(order.store_id),
  };
}

/**
 * Take an order off hold if it is On Hold; answers whether it was. Detach and reset use it
 * for every order the ERP still holds, so no Commerce order stays On Hold for an ERP that
 * is being wiped or removed.
 * @returns {Promise<boolean>} true when the order was On Hold and is not any more
 */
export async function unholdIfHeld(params, orderId) {
  const client = await commerceClient(params);
  const order = await client.get(`orders/${orderId}`).json();
  if (order?.state !== "holded") {
    return false;
  }
  await client.post(`orders/${orderId}/unhold`);
  return true;
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
            is_visible_on_front: 0,
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
          comment: { comment, is_visible_on_front: 0 },
          items,
          notify: false,
        },
      })
      .json(),
};
