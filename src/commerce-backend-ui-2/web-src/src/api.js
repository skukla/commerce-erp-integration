/*
 * Calls this app's own actions with the IMS token the Commerce Admin (or the shell) hands
 * over. The actions live beside the page on the same App Builder host, so their addresses
 * come from the page's origin: extension apps keep their package names (Demo Builder
 * renames packages only for plain apps), so `erp/<action>` is stable.
 */
/* global fetch, window */

import { settingsPath } from "#web/settings-view.js";

const PACKAGE = "erp";

export function makeApi(ims, origin = window.location.origin) {
  async function call(action, { method = "GET", body } = {}) {
    const res = await fetch(`${origin}/api/v1/web/${PACKAGE}/${action}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${ims.imsToken}`,
        "Content-Type": "application/json",
        "x-gw-ims-org-id": ims.imsOrgId,
      },
      method,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!res.ok) {
      throw new Error(
        data.message || data.error || `${action} answered ${res.status}`,
      );
    }
    return data;
  }
  return {
    // The ERP list (erp/erps), and a save of one ERP's own settings at its defaults or at
    // one website; `null` for a value means "use the integration's".
    erps: () => call("erps"),
    // `erp`: with several ERPs, only that ERP's records (erp/history).
    history: (failedOnly, erp) => {
      const query = new URLSearchParams({
        ...(failedOnly ? { failedOnly: "true" } : {}),
        ...(erp ? { erp } : {}),
      }).toString();
      return call(query ? `history?${query}` : "history");
    },
    // `{ sku }` or `{ company }`: one entity as both systems hold it (erp/lookup).
    lookup: (query) => call(`lookup?${new URLSearchParams(query).toString()}`),
    // The product grid's stock move (erp/move-stock): the sources, then the move.
    moveStock: (body) => call("move-stock", { body, method: "POST" }),
    moveStockSources: () => call("move-stock"),
    // The order view's "ERP parts" page: one order's parts by its Commerce order id, and
    // Re-send of one held or failed part (erp/order-parts, erp/resend-part).
    orderParts: (orderId) =>
      call(`order-parts?orderId=${encodeURIComponent(orderId)}`),
    resendPart: (incrementId, erpId) =>
      call("resend-part", { body: { erpId, incrementId }, method: "POST" }),
    // `{ incrementId }` for an order, `{ eventId }` for an ERP event (history-view.js).
    retry: (target) => call("history", { body: target, method: "POST" }),
    saveErpSettings: (id, website, values) =>
      call("erps", { body: { id, values, website }, method: "PATCH" }),
    // The merchant's settings at one scope, and a save of only what changed. `null`
    // for a value means "use the wider scope's value" (erp/settings).
    saveSettings: (scope, values) =>
      call("settings", { body: { scope, values }, method: "PATCH" }),
    // The scheduled runs: when each last ran and what it changed (erp/history).
    scheduled: () => call("history?scheduled=true"),
    settings: (scope, options) => call(settingsPath(scope, options)),
    status: () => call("status"),
    // One order's whole life, gathered from Commerce, this history and the ERP.
    trace: (incrementId) =>
      call(`history?trace=${encodeURIComponent(incrementId)}`),
  };
}
