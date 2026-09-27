/*
 * The Admin page as it looks, rendered against stand-in data (fake-api.js): `?section=`
 * opens a section (overview, activity, settings), `?loading` shows what the page shows until
 * everything has arrived, `?crash` the crash screen.
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
import { fakeApi } from "./fake-api.js";

const api = fakeApi();
const asked = new URLSearchParams(window.location.search);

// `?crash` shows the crash screen the Admin page falls back to.
function Crash() {
  throw new Error("A crash asked for by ?crash");
}

function Preview() {
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [settingsPage, setSettingsPage] = useState(null);
  const [log, setLog] = useState([]);
  useEffect(() => {
    if (asked.has("loading")) {
      return;
    }
    Promise.all([api.status(), api.settings(undefined)]).then(([s, page]) => {
      setStatus(s);
      setSettingsPage(page);
    });
  }, []);
  const run = useCallback(async (label, fn) => {
    const result = await fn();
    setLog((l) => [
      `${new Date().toLocaleTimeString()} ${label}: ${JSON.stringify(result)}`,
      ...l,
    ]);
  }, []);
  return (
    // Commerce Admin is always light, whatever the browser prefers.
    <Provider background="base" colorScheme="light">
      {status && settingsPage ? (
        <IntegrationPage
          api={api}
          busy={false}
          error={error}
          initialSection={asked.get("section") || "overview"}
          log={log}
          onError={setError}
          run={run}
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
  <CrashBoundary>{asked.has("crash") ? <Crash /> : <Preview />}</CrashBoundary>,
);
