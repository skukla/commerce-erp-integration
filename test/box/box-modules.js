/*
 * The module stand-ins every pair-in-a-box test file mocks with. vitest hoists `vi.mock`
 * only within a test file, so each file keeps its own `vi.mock` calls and hands them these.
 */

/** The website settings the box runs with: orders are sent, and held while the ERP is away. */
export function settingsModule() {
  const settings = {
    orders_confirm_status: "",
    orders_hold_offline: true,
    orders_send: true,
  };
  return {
    SETTING_DEFAULTS: { ...settings },
    settingsFor: async () => ({ ...settings }),
    websiteSettings: async () => ({ structure_sales_org: "1000" }),
  };
}

/**
 * `#lib/erp` with every route answered by `call` instead of over HTTP.
 * @param {(action: string, request?: { method?: string, path?: string, body?: object,
 *   params?: object }) => Promise<{ ok: boolean, status: number, data: object }>} call
 *   answers one ERP request the way `erpRequest` does
 */
export function erpClientModule(call) {
  const post = (action, path, body) => (params) =>
    call(action, { body, method: "POST", params, path });
  return {
    erp: {
      createOrder: (params, order) =>
        call("orders", { body: order, method: "POST", params }),
      deleteProduct: (params, sku, body) =>
        call("products", {
          body,
          method: "DELETE",
          params,
          path: `/${encodeURIComponent(sku)}`,
        }),
      fromCommerce: {
        cancel: (params, number, body) =>
          post("orders", `/${number}/cancel`, body)(params),
        hold: (params, number, body) =>
          post("orders", `/${number}/credit/hold`, body)(params),
        invoice: (params, number, body) =>
          post("orders", `/${number}/commerce-invoice`, body)(params),
        release: (params, number, body) =>
          post("orders", `/${number}/credit/release`, body)(params),
        ship: (params, number, body) =>
          post("orders", `/${number}/commerce-shipment`, body)(params),
      },
      health: (params) => call("health", { params }),
      importRecords: (params, body) =>
        call("admin", { body, method: "POST", params, path: "/import" }),
      inForce: (params, partnerId) =>
        call("contracts", {
          params,
          path: partnerId
            ? `/in-force?partnerId=${encodeURIComponent(partnerId)}`
            : "/in-force",
        }),
      listOrders: (params) => call("orders", { params }),
      order: (params, number) => call("orders", { params, path: `/${number}` }),
      ordersByReference: (params, reference) =>
        call("orders", {
          params,
          path: `?reference=${encodeURIComponent(reference)}`,
        }),
      product: (params, sku) =>
        call("products", { params, path: `/${encodeURIComponent(sku)}` }),
      settings: (params) => call("settings", { params }),
    },
    erpAuthHeaders: async () => ({}),
    erpBaseUrl: () => "in-process",
    erpRequest: async () => ({ data: {}, ok: false, status: 500 }),
    resetErpTokenCache: () => undefined,
  };
}
