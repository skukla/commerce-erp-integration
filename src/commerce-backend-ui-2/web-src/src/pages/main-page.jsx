import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import { Heading, InlineAlert, Text } from "@react-spectrum/s2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";
import { PageShell } from "#web/components/page-shell.jsx";
import { isSyncActive } from "#web/components/sync-progress.jsx";

const SYNC_POLL_MS = 2000;

/**
 * The integration's page in the Commerce Admin: everything it needs from the actions —
 * the sign-in, the status, the scopes — and `PageShell` for how it looks. Split so the
 * layout can be rendered against stand-in data without a Commerce Admin (AB-10, step 4).
 */
export function MainPage() {
  const { data: ims, error: imsError } = useIms();
  const api = useMemo(() => (ims ? makeApi(ims) : null), [ims]);
  const [status, setStatus] = useState(null);
  const [scopes, setScopes] = useState(null);
  const [scopesNote, setScopesNote] = useState(null);
  const [scopeId, setScopeId] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  const refresh = useCallback(async () => {
    if (!api) {
      return;
    }
    try {
      setStatus(await api.status());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The scopes a merchant can switch between: the settings action reads Commerce's
  // websites the first time anyone asks, and again when the merchant presses Refresh
  // websites (Commerce does not keep the list in step on its own).
  const loadScopes = useCallback(
    (readAgain = false) => {
      if (!api) {
        return;
      }
      api
        .settings(undefined, { refresh: readAgain })
        .then((page) => {
          setScopes(page.scopes);
          setScopesNote(page.scopesNote ?? null);
        })
        .catch((e) => setError(`Scopes could not be read: ${e.message}`));
    },
    [api],
  );
  useEffect(() => {
    loadScopes();
  }, [loadScopes]);
  const refreshScopes = useCallback(() => loadScopes(true), [loadScopes]);

  // While the ERP reports a sync in progress, keep reading it. This also picks up a
  // sync started elsewhere (the ERP's own Settings) or before the page was opened.
  const sync = status?.erp?.sync ?? null;
  useEffect(() => {
    if (!isSyncActive(sync)) {
      return;
    }
    const timer = setTimeout(refresh, SYNC_POLL_MS);
    return () => clearTimeout(timer);
  }, [sync, refresh]);

  const run = useCallback(
    async (label, fn) => {
      setBusy(true);
      try {
        const result = await fn();
        setLog((l) =>
          [
            `${new Date().toLocaleTimeString()} ${label}: ${JSON.stringify(result)}`,
            ...l,
          ].slice(0, 20),
        );
        setError(null);
        await refresh();
      } catch (e) {
        setError(`${label} failed: ${e.message}`);
      }
      setBusy(false);
    },
    [refresh],
  );

  if (imsError) {
    return (
      <InlineAlert variant="negative">
        <Heading>No sign-in</Heading>
        <Text>{imsError.message}</Text>
      </InlineAlert>
    );
  }
  return (
    <PageShell
      api={api}
      busy={busy}
      erpName={status?.erp?.displayName || "the ERP"}
      error={error}
      log={log}
      onError={setError}
      onRefreshScopes={refreshScopes}
      onScopeChange={setScopeId}
      run={run}
      scopeId={scopeId}
      scopes={scopes}
      scopesNote={scopesNote}
      status={status}
    />
  );
}
