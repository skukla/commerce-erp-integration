import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import { Button, Heading, InlineAlert, Text } from "@react-spectrum/s2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";
import { Stat } from "#web/components/stat.jsx";

const SYNC_POLL_MS = 3000;
const SYNC_WAIT_MS = 5 * 60 * 1000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll the status until the ERP's last full import moves past `before`, or time runs out. */
async function waitForImport(api, before, deadline) {
  await wait(SYNC_POLL_MS);
  const next = await api.status();
  if (next.erp?.lastImportAt && next.erp.lastImportAt !== before) {
    return { synced: next.erp.counts };
  }
  if (Date.now() >= deadline) {
    return { stillRunning: true };
  }
  return waitForImport(api, before, deadline);
}

/** Online, Offline or Unreachable, from the status action's answer. */
function erpState(erp) {
  if (!erp.reachable) {
    return "Unreachable";
  }
  return erp.offline ? "Offline" : "Online";
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
  const erpOffline = Boolean(status?.erp?.offline);
  const onSync = useCallback(
    () => run("Refresh partners", api.refreshPartners),
    [run, api],
  );
  // The mirror runs in the background, so this starts it and then watches the ERP's
  // last-import time move (a partners-only refresh does not move it).
  const onSyncRecords = useCallback(
    () =>
      run("Sync records", async () => {
        const before = status?.erp?.lastImportAt ?? null;
        await api.syncRecords();
        return waitForImport(api, before, Date.now() + SYNC_WAIT_MS);
      }),
    [run, api, status],
  );
  const onToggleOffline = useCallback(
    () =>
      run(erpOffline ? "Bring online" : "Take offline", () =>
        api.setOffline(!erpOffline),
      ),
    [run, api, erpOffline],
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
          isDisabled={busy || !api}
          onPress={onSyncRecords}
          variant="secondary">
          Sync records to {erpName}
        </Button>
        <Button
          isDisabled={busy || !api}
          onPress={onToggleOffline}
          variant="secondary">
          {erp.offline ? `Bring ${erpName} online` : `Take ${erpName} offline`}
        </Button>
        <Button isDisabled={busy || !api} onPress={onReset} variant="negative">
          Reset ERP records
        </Button>
      </div>
      <Text>
        Reset undoes the company blocks and credit limits the ERP set, wipes
        every ERP record, and mirrors Commerce again as it stands. Commerce
        orders keep their ERP numbers.
      </Text>
      {log.length > 0 && <div className="erp-log">{log.join("\n")}</div>}
    </main>
  );
}
