import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import { Heading, InlineAlert, Text } from "@react-spectrum/s2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";
import {
  IntegrationPage,
  PageLoading,
} from "#web/components/integration-page.jsx";
import { isSyncActive } from "#web/components/sync-progress.jsx";

const SYNC_POLL_MS = 2000;

/**
 * The integration's page in the Commerce Admin: the sign-in, the status and the settings,
 * read together, and nothing drawn until all of them are in (owner, 2026-09-27: a half-loaded
 * page showed "the ERP" and "Reading the settings…"). The website list is read from Commerce
 * again on every open (owner, 2026-09-26), so there is no Refresh button. How it looks is
 * IntegrationPage, which the local preview renders against stand-in data.
 */
export function MainPage() {
  const { data: ims, error: imsError } = useIms();
  const api = useMemo(() => (ims ? makeApi(ims) : null), [ims]);
  const [status, setStatus] = useState(null);
  const [settingsPage, setSettingsPage] = useState(null);
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
    if (!api) {
      return;
    }
    Promise.all([api.status(), api.settings(undefined, { refresh: true })])
      .then(([statusAnswer, page]) => {
        setStatus(statusAnswer);
        setSettingsPage(page);
      })
      .catch((e) => setError(e.message));
  }, [api]);

  // While the ERP reports a sync in progress, keep reading it.
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

  const failed = imsError?.message ?? (status && settingsPage ? null : error);
  if (failed) {
    return (
      <InlineAlert variant="negative">
        <Heading>The integration's page could not load</Heading>
        <Text>{failed}</Text>
      </InlineAlert>
    );
  }
  if (!(status && settingsPage)) {
    return <PageLoading />;
  }
  return (
    <IntegrationPage
      api={api}
      busy={busy}
      error={error}
      log={log}
      onError={setError}
      run={run}
      scopes={settingsPage.scopes}
      scopesNote={settingsPage.scopesNote ?? null}
      settingsPage={settingsPage}
      status={status}
    />
  );
}
