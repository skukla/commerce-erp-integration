import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import { Button, Heading, InlineAlert, Text } from "@react-spectrum/s2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";
import { History } from "#web/components/history.jsx";
import { OrderTrace } from "#web/components/order-trace.jsx";
import { Stat } from "#web/components/stat.jsx";
import { isSyncActive, SyncProgress } from "#web/components/sync-progress.jsx";

const SYNC_POLL_MS = 2000;

/** Online or Unreachable, from the status action's answer. */
function erpState(erp) {
  return erp.reachable ? "Online" : "Unreachable";
}

/** The merchant's view of the integration: both apps' health, the ERP's controls, a log of what ran. */
export function MainPage() {
  const { data: ims, error: imsError } = useIms();
  const api = useMemo(() => (ims ? makeApi(ims) : null), [ims]);
  const [status, setStatus] = useState(null);
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
  const onSync = useCallback(
    () => run("Refresh partners", api.refreshPartners),
    [run, api],
  );
  // The mirror runs in the background and reports each step to the ERP; the effect
  // above follows it.
  const onSyncRecords = useCallback(
    () => run("Sync records", api.syncRecords),
    [run, api],
  );
  const onReset = useCallback(() => run("Reset", api.reset), [run, api]);

  if (imsError) {
    return (
      <InlineAlert variant="negative">
        <Heading>No sign-in</Heading>
        <Text>{imsError.message}</Text>
      </InlineAlert>
    );
  }
  const erp = status?.erp ?? {};
  const erpName = erp.displayName || "the ERP";
  return (
    <main>
      <Heading level={1}>ERP integration</Heading>
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
      <div className="erp-grid">
        <Stat label="ERP" value={erpState(erp)} />
        <Stat label="Products" value={erp.counts?.products ?? "–"} />
        <Stat
          label="Business partners"
          value={erp.counts?.businessPartners ?? "–"}
        />
        <Stat label="Sales orders" value={erp.counts?.salesOrders ?? "–"} />
        <Stat label="ERP events pending" value={erp.counts?.events ?? "–"} />
        <Stat
          label="Company changes to undo on reset"
          value={status?.ledger?.entries ?? "–"}
        />
      </div>
      <Text>
        Last import into the ERP: {erp.lastImportAt || "never"}. Last wipe:{" "}
        {erp.lastWipeAt || "never"}.
      </Text>
      <div className="erp-actions">
        <Button isDisabled={busy || !api} onPress={onSync} variant="primary">
          Refresh partners from Commerce
        </Button>
        <Button
          isDisabled={busy || !api || isSyncActive(sync)}
          onPress={onSyncRecords}
          variant="secondary">
          Sync records to {erpName}
        </Button>
        <Button isDisabled={busy || !api} onPress={onReset} variant="negative">
          Reset ERP records
        </Button>
      </div>
      <SyncProgress erpName={erpName} sync={sync} />
      <Text>
        Reset undoes the company blocks and credit limits the ERP set, wipes
        every ERP record, and mirrors Commerce again as it stands. Commerce
        orders keep their ERP numbers.
      </Text>
      <OrderTrace api={api} erpName={erpName} onError={setError} />
      <History api={api} erpName={erpName} onError={setError} />
      {log.length > 0 && <div className="erp-log">{log.join("\n")}</div>}
    </main>
  );
}
