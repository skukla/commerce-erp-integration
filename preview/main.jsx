/* The Admin page's own shell and components, rendered against stand-in data. */
import "@react-spectrum/s2/page.css";
import "../src/commerce-backend-ui-2/web-src/index.css";

import { Provider } from "@react-spectrum/s2";
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";

import { PageShell } from "../src/commerce-backend-ui-2/web-src/src/components/page-shell.jsx";
import { BODEA_SCOPE_TREE } from "../test/web/fixtures/bodea-scope-tree.js";
import { fakeApi } from "./fake-api.js";

const api = fakeApi();

const asked = new URLSearchParams(window.location.search);

function readScopesAgain() {
  // The preview has one fixed tree, so Refresh websites has nothing to read again.
}

function Preview() {
  const [scopeId, setScopeId] = useState("");
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [log, setLog] = useState([]);
  if (!status) {
    api.status().then(setStatus);
  }
  const run = useCallback(async (label, fn) => {
    const result = await fn();
    setLog((l) => [
      `${new Date().toLocaleTimeString()} ${label}: ${JSON.stringify(result)}`,
      ...l,
    ]);
  }, []);
  return (
    <Provider background="base">
      <PageShell
        api={api}
        busy={false}
        erpName={status?.erp?.displayName || "the ERP"}
        error={error}
        log={log}
        onError={setError}
        onRefreshScopes={readScopesAgain}
        onScopeChange={setScopeId}
        run={run}
        scopeId={scopeId}
        scopes={status ? BODEA_SCOPE_TREE : null}
        selectedTab={asked.get("tab") || "mapping"}
        status={status}
      />
    </Provider>
  );
}

createRoot(document.getElementById("root")).render(<Preview />);
