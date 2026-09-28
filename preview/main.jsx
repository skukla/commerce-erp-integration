/*
 * The Admin page as it looks, rendered against stand-in data (fake-api.js): `?section=`
 * opens a section (overview, activity, settings), `?loading` shows what the page shows until
 * everything has arrived, `?crash` the crash screen, `?one-erp` the header with one ERP, and
 * `?page=order-parts` the order view's "ERP parts" page.
 */
import "@react-spectrum/s2/page.css";
import "../src/commerce-backend-ui-2/web-src/index.css";

import { Provider } from "@react-spectrum/s2";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { CrashBoundary } from "../src/commerce-backend-ui-2/web-src/src/components/crash-boundary.jsx";
import {
  IntegrationPage,
  PageLoading,
} from "../src/commerce-backend-ui-2/web-src/src/components/integration-page.jsx";
import { OrderParts } from "../src/commerce-backend-ui-2/web-src/src/components/order-parts.jsx";
import { fakeApi } from "./fake-api.js";

const asked = new URLSearchParams(window.location.search);
const api = fakeApi({ oneErp: asked.has("one-erp") });

// `?crash` shows the crash screen the Admin page falls back to.
function Crash() {
  throw new Error("A crash asked for by ?crash");
}

/** The order view's "ERP parts" page, against one stand-in routed order. */
function PartsPreview() {
  const [error, setError] = useState(null);
  const [page, setPage] = useState(null);
  const load = useCallback(() => api.orderParts().then(setPage), []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <Provider background="base" colorScheme="light">
      {error && <p>{error}</p>}
      {page ? (
        <OrderParts api={api} onError={setError} onReload={load} page={page} />
      ) : (
        <PageLoading />
      )}
    </Provider>
  );
}

function Preview() {
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [settingsPage, setSettingsPage] = useState(null);
  useEffect(() => {
    if (asked.has("loading")) {
      return;
    }
    Promise.all([api.status(), api.settings(undefined)]).then(([s, page]) => {
      setStatus(s);
      setSettingsPage(page);
    });
  }, []);
  return (
    // Commerce Admin is always light, whatever the browser prefers.
    <Provider background="base" colorScheme="light">
      {status && settingsPage ? (
        <IntegrationPage
          api={api}
          error={error}
          initialSection={asked.get("section") || "overview"}
          onError={setError}
          scopes={settingsPage.scopes}
          scopesNote={null}
          settingsPage={settingsPage}
          status={status}
        />
      ) : (
        <PageLoading />
      )}
    </Provider>
  );
}

createRoot(document.getElementById("root")).render(
  <CrashBoundary>
    {asked.has("crash") && <Crash />}
    {!asked.has("crash") &&
      (asked.get("page") === "order-parts" ? <PartsPreview /> : <Preview />)}
  </CrashBoundary>,
);
