/*
 * The ERP's API, called with a token minted from the injected IMS server-to-server
 * credential (the same one that authenticates Commerce calls). The ERP's actions are
 * `require-adobe-auth`, so no shared secret exists between the two apps.
 */
import {
  getImsAuthProvider,
  resolveImsAuthParams,
} from "@adobe/aio-commerce-sdk/auth";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;
const tokenCache = new Map();
const TRAILING_SLASHES = /\/+$/u;

/** @returns {string} the ERP's web-action base, without a trailing slash */
export function erpBaseUrl(params) {
  const base = String(params.ERP_BASE_URL || "").replace(TRAILING_SLASHES, "");
  if (!base) {
    throw new Error(
      "ERP_BASE_URL is not set: the ERP component must be deployed first",
    );
  }
  return base;
}

/**
 * Bearer + api key + org headers for the ERP, cached per client id for a short while.
 * @param {object} params action inputs carrying AIO_COMMERCE_AUTH_IMS_*
 */
export async function erpAuthHeaders(params) {
  const auth = resolveImsAuthParams(params);
  const cached = tokenCache.get(auth.clientId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.headers;
  }
  const headers = {
    ...(await getImsAuthProvider(auth).getHeaders()),
    "x-gw-ims-org-id": auth.imsOrgId,
  };
  tokenCache.set(auth.clientId, {
    expiresAt: Date.now() + TOKEN_TTL_MS,
    headers,
  });
  return headers;
}

/** Test seam: forget cached tokens. */
export function resetErpTokenCache() {
  tokenCache.clear();
}

/**
 * One request to the ERP.
 * @returns {Promise<{ ok: boolean, status: number, data: object }>} never throws on an HTTP error;
 *   throws on a missing base URL, a network failure or a timeout
 */
export async function erpRequest(
  params,
  action,
  { method = "GET", path = "", body, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const url = `${erpBaseUrl(params)}/${action}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(await erpAuthHeaders(params)),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method,
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { errorMessage: text };
    }
    return { data, ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

/** The ERP's routes, by name. Each answers `{ ok, status, data }`. */
export const erp = {
  createOrder: (params, order, timeoutMs) =>
    erpRequest(params, "orders", { body: order, method: "POST", timeoutMs }),
  /**
   * The moves a change made IN Commerce asks of the ERP (contract order.external). Each
   * body carries `origin: { system, document, eventId? }`, which the ERP journals as the source.
   * The ERP raises its own event for the move all the same (contract version 19); the callers
   * send through lib/own-writes.js sentToErp, so the ingestion webhook knows it as the echo.
   */
  fromCommerce: {
    cancel: (params, number, body) =>
      erpRequest(params, "orders", {
        body,
        method: "POST",
        path: `/${number}/cancel`,
      }),
    hold: (params, number, body) =>
      erpRequest(params, "orders", {
        body,
        method: "POST",
        path: `/${number}/credit/hold`,
      }),
    invoice: (params, number, body) =>
      erpRequest(params, "orders", {
        body,
        method: "POST",
        path: `/${number}/external-invoice`,
      }),
    release: (params, number, body) =>
      erpRequest(params, "orders", {
        body,
        method: "POST",
        path: `/${number}/credit/release`,
      }),
    /**
     * A Commerce return, this ERP's lines of it, as a return order (contract version 13). The
     * body names the ERP's own sales order (`orderNumber`); the ERP is idempotent on
     * `customerReturnReference`, answering the return order it already made.
     */
    sendReturn: (params, body) =>
      erpRequest(params, "returns", { body, method: "POST" }),
    ship: (params, number, body) =>
      erpRequest(params, "orders", {
        body,
        method: "POST",
        path: `/${number}/external-shipment`,
      }),
  },
  health: (params) => erpRequest(params, "health"),
  importRecords: (params, body) =>
    erpRequest(params, "admin", {
      body,
      method: "POST",
      path: "/import",
      timeoutMs: 60_000,
    }),
  /**
   * Today's contract prices in force (contract version 6): `{ items: [{ partnerId, lines }] }`
   * for every customer with a line, or exactly one customer's with `partnerId`.
   */
  inForce: (params, partnerId, timeoutMs) =>
    erpRequest(params, "contracts", {
      path: partnerId
        ? `/in-force?partnerId=${encodeURIComponent(partnerId)}`
        : "/in-force",
      timeoutMs,
    }),
  listOrders: (params) => erpRequest(params, "orders"),
  /** One sales order by its ERP number, with the ERP's own status history. */
  order: (params, number, timeoutMs) =>
    erpRequest(params, "orders", { path: `/${number}`, timeoutMs }),
  /**
   * The sales orders carrying a customer reference (the buyer's Commerce order number):
   * a standard ERP filter (SAP PurchaseOrderByCustomer, Business Central
   * externalDocumentNumber). Answers `{ items }`.
   */
  ordersByReference: (params, reference, timeoutMs) =>
    erpRequest(params, "orders", {
      path: `?reference=${encodeURIComponent(reference)}`,
      timeoutMs,
    }),
  /** One business partner's document by its ERP id (with its credit figures). */
  partner: (params, id, timeoutMs) =>
    erpRequest(params, "partners", {
      path: `/${encodeURIComponent(id)}`,
      timeoutMs,
    }),
  /**
   * Change one product in the ERP (contract `PATCH products/:sku`): here, its sales status —
   * `discontinued` (contract version 20) when this ERP no longer carries it because another
   * ERP owns it now, and back to `sellable` when it owns it again.
   */
  patchProduct: (params, sku, body, timeoutMs) =>
    erpRequest(params, "products", {
      body,
      method: "PATCH",
      path: `/${encodeURIComponent(sku)}`,
      timeoutMs,
    }),
  /** One product's document by SKU (with committed and available). */
  product: (params, sku, timeoutMs) =>
    erpRequest(params, "products", {
      path: `/${encodeURIComponent(sku)}`,
      timeoutMs,
    }),
  settings: (params) => erpRequest(params, "settings"),
};
