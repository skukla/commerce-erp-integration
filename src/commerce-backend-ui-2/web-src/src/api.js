/*
 * Calls this app's own actions with the IMS token the Commerce Admin (or the shell) hands
 * over. The actions live beside the page on the same App Builder host, so their addresses
 * come from the page's origin: extension apps keep their package names (Demo Builder
 * renames packages only for plain apps), so `erp/<action>` is stable.
 */
/* global fetch, window */

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
    history: (failedOnly) =>
      call(failedOnly ? "history?failedOnly=true" : "history"),
    refreshPartners: () => call("refresh-partners", { method: "POST" }),
    reset: () => call("reset", { method: "POST" }),
    // `{ incrementId }` for an order, `{ eventId }` for an ERP event (history-view.js).
    retry: (target) => call("history", { body: target, method: "POST" }),
    // The merchant's settings at one scope, and a save of only what changed. `null`
    // for a value means "use the wider scope's value" (erp/settings).
    saveSettings: (scope, values) =>
      call("settings", { body: { scope, values }, method: "PATCH" }),
    settings: (scope) =>
      call(scope ? `settings?scope=${encodeURIComponent(scope)}` : "settings"),
    status: () => call("status"),
    // Background mode: a web request is cut off after a minute, a mirror can take
    // longer. Answers 202; the page watches the ERP's last-import time.
    syncRecords: () => call("mirror?background=true", { method: "POST" }),
    // One order's whole life, gathered from Commerce, this history and the ERP.
    trace: (incrementId) =>
      call(`history?trace=${encodeURIComponent(incrementId)}`),
  };
}
