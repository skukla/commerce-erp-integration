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
  health: (params) => erpRequest(params, "health"),
  importRecords: (params, body) =>
    erpRequest(params, "admin", {
      body,
      method: "POST",
      path: "/import",
      timeoutMs: 60_000,
    }),
  listOrders: (params) => erpRequest(params, "orders"),
  patchSettings: (params, patch) =>
    erpRequest(params, "settings", { body: patch, method: "PATCH" }),
  quote: (params, body, timeoutMs) =>
    erpRequest(params, "pricing", {
      body,
      method: "POST",
      path: "/quote",
      timeoutMs,
    }),
  // One step of a sync, for the ERP's sync record (contract `sync.status`).
  reportSync: (params, step) =>
    erpRequest(params, "admin", { body: step, method: "POST", path: "/sync" }),
  settings: (params) => erpRequest(params, "settings"),
  wipe: (params) =>
    erpRequest(params, "admin", {
      method: "POST",
      path: "/wipe",
      timeoutMs: 60_000,
    }),
};
