import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import {
  Heading,
  InlineAlert,
  Picker,
  PickerItem,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
} from "@react-spectrum/s2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";
import { SettingsForm } from "#web/components/settings-form.jsx";
import { StatusTab } from "#web/components/status-tab.jsx";
import { isSyncActive } from "#web/components/sync-progress.jsx";
import { scopeChoices } from "#web/settings-view.js";

const SYNC_POLL_MS = 2000;

/**
 * The integration's page in the Commerce Admin, laid out like Live Search: a scope bar,
 * then tabs. Settings is what a merchant comes here to change — what is sent to the ERP
 * and what Commerce does with its answers, per website; Status & sync is how it is doing
 * and what has crossed.
 */
export function MainPage() {
  const { data: ims, error: imsError } = useIms();
  const api = useMemo(() => (ims ? makeApi(ims) : null), [ims]);
  const [status, setStatus] = useState(null);
  const [scopes, setScopes] = useState(null);
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

  // The scopes a merchant can switch between are read once: the settings action syncs
  // Commerce's websites the first time anyone asks for them.
  useEffect(() => {
    if (!api) {
      return;
    }
    api
      .settings()
      .then((page) => setScopes(page.scopes))
      .catch((e) => setError(`Scopes could not be read: ${e.message}`));
  }, [api]);

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

  const choices = scopeChoices(scopes);
  const scopeLevel =
    choices.find((choice) => choice.id === scopeId)?.level ?? "global";

  if (imsError) {
    return (
      <InlineAlert variant="negative">
        <Heading>No sign-in</Heading>
        <Text>{imsError.message}</Text>
      </InlineAlert>
    );
  }
  const erpName = status?.erp?.displayName || "the ERP";
  return (
    <main>
      <Heading level={1}>{erpName}</Heading>
      <Text>
        Orders flow to {erpName} with its number written back; contract prices
        and the discount ceiling apply at cart time; the ERP's prices, stock,
        credit limits and order statuses flow back here every minute.
      </Text>
      {error && (
        <InlineAlert variant="negative">
          <Heading>Something went wrong</Heading>
          <Text>{error}</Text>
        </InlineAlert>
      )}
      <div className="erp-scope-bar">
        <Picker
          aria-label="Scope"
          items={choices}
          onSelectionChange={setScopeId}
          selectedKey={scopeId}>
          {(choice) => <PickerItem id={choice.id}>{choice.label}</PickerItem>}
        </Picker>
        <span className="erp-scope-note">
          Settings apply to this scope and anything under it.
        </span>
      </div>
      <Tabs aria-label="ERP integration">
        <TabList>
          <Tab id="settings">Settings</Tab>
          <Tab id="status">Status &amp; sync</Tab>
        </TabList>
        <TabPanel id="settings">
          <SettingsForm
            api={api}
            onError={setError}
            scopeId={scopeId}
            scopeLevel={scopeLevel}
          />
        </TabPanel>
        <TabPanel id="status">
          <StatusTab
            api={api}
            busy={busy}
            erpName={erpName}
            log={log}
            onError={setError}
            run={run}
            status={status}
          />
        </TabPanel>
      </Tabs>
    </main>
  );
}
