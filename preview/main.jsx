/* The Admin page's own shell and components, rendered against stand-in data. */
import "@react-spectrum/s2/page.css";
import "../src/commerce-backend-ui-2/web-src/index.css";

import { Provider } from "@react-spectrum/s2";
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";

import { PageShell } from "../src/commerce-backend-ui-2/web-src/src/components/page-shell.jsx";
import { fakeApi } from "./fake-api.js";

const api = fakeApi();

const asked = new URLSearchParams(window.location.search);

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
        onScopeChange={setScopeId}
        run={run}
        scopeId={scopeId}
        scopes={
          status
            ? [
                {
                  code: "global",
                  id: "global",
                  level: "global",
                  name: "Default Config",
                },
                { code: "bodea", id: "w1", level: "website", name: "Bodea" },
                {
                  code: "bodea_store",
                  id: "s1",
                  level: "store",
                  name: "Bodea Store",
                },
                {
                  code: "bodea_us",
                  id: "v1",
                  level: "storeView",
                  name: "Bodea US",
                },
              ]
            : null
        }
        selectedTab={asked.get("tab") || "mapping"}
        status={status}
      />
    </Provider>
  );
}

createRoot(document.getElementById("root")).render(<Preview />);
