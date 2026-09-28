/*
 * The Admin page as it looks, rendered against stand-in data (fake-api.js), inside a simple
 * stand-in for Commerce Admin's own left rail and page title (preview/chrome.css), which the
 * real Admin draws around the page. `?section=` opens a tab (overview, activity, settings),
 * `?ok` shows the store with nothing wrong, `?one-erp` a store with one ERP, `?loading` what
 * the page shows until everything has arrived, `?crash` the crash screen, `?page=order-parts`
 * the order view's "ERP parts" page, and `?bare` the page without the Admin stand-in.
 */
import "@react-spectrum/s2/page.css";
import "../src/commerce-backend-ui-2/web-src/index.css";
import "./chrome.css";

import { Provider } from "@react-spectrum/s2";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { CrashBoundary } from "../src/commerce-backend-ui-2/web-src/src/components/crash-boundary.jsx";
import {
  IntegrationPage,
  PageLoading,
} from "../src/commerce-backend-ui-2/web-src/src/components/integration-page.jsx";
import { OrderParts } from "../src/commerce-backend-ui-2/web-src/src/components/order-parts.jsx";
import { readFirst } from "../src/commerce-backend-ui-2/web-src/src/first-read.js";
import { fakeApi } from "./fake-api.js";

const asked = new URLSearchParams(window.location.search);
const api = fakeApi({ allGood: asked.has("ok"), oneErp: asked.has("one-erp") });

// `?crash` shows the crash screen the Admin page falls back to.
function Crash() {
  throw new Error("A crash asked for by ?crash");
}

/** A stand-in for the Admin's own rail and page title; the real Admin draws these. */
function AdminChrome({ children, title }) {
  if (asked.has("bare")) {
    return children;
  }
  return (
    <div className="preview-admin">
      <nav aria-label="Admin menu (preview stand-in)" className="preview-rail">
        <div className="preview-logo">A</div>
        {["Dashboard", "Sales", "Catalog", "Customers", "Marketing", "Content", "Reports", "Stores", "System", "Apps"].map(
          (item) => (
            <span className={item === "Apps" ? "is-active" : ""} key={item}>
              {item}
            </span>
          ),
        )}
      </nav>
      <div className="preview-content">
        <header className="preview-header">
          <h1>{title}</h1>
        </header>
        {children}
      </div>
    </div>
  );
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
    <AdminChrome title="#3000000027">
      <main className="erp-subpage">
        {error && <p>{error}</p>}
        {page ? (
          <OrderParts api={api} onError={setError} onReload={load} page={page} />
        ) : (
          <PageLoading />
        )}
      </main>
    </AdminChrome>
  );
}

function Preview() {
  const [error, setError] = useState(null);
  const [initial, setInitial] = useState(null);
  useEffect(() => {
    if (asked.has("loading")) {
      return;
    }
    readFirst(api, { refresh: false }).then((read) => {
      setInitial(read.initial);
      setError(read.trouble);
    });
  }, []);
  return (
    <AdminChrome title="ERP Integration">
      {initial ? (
        <IntegrationPage
          api={api}
          error={error}
          initial={initial}
          initialTab={asked.get("section") || "overview"}
          onError={setError}
        />
      ) : (
        <PageLoading />
      )}
    </AdminChrome>
  );
}

createRoot(document.getElementById("root")).render(
  // The Admin UI library wraps the page in Spectrum's Provider (which loads Adobe Clean);
  // Commerce Admin is always light, whatever the browser prefers.
  <Provider background="base" colorScheme="light">
    <CrashBoundary>
      {asked.has("crash") && <Crash />}
      {!asked.has("crash") &&
        (asked.get("page") === "order-parts" ? <PartsPreview /> : <Preview />)}
    </CrashBoundary>
  </Provider>,
);
