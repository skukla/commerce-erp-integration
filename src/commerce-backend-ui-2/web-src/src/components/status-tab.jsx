import { Button, Text } from "@react-spectrum/s2";
import { useCallback } from "react";

import { History } from "#web/components/history.jsx";
import { OrderTrace } from "#web/components/order-trace.jsx";
import { Stat } from "#web/components/stat.jsx";
import { isSyncActive, SyncProgress } from "#web/components/sync-progress.jsx";

/** Online or Unreachable, from the status action's answer. */
function erpState(erp) {
  return erp.reachable ? "Online" : "Unreachable";
}

/**
 * How the integration is doing and what it has done: both sides' health and counts, the
 * controls that mirror or reset the ERP's records, one order followed end to end, and
 * everything that has crossed with a Retry on what did not get through.
 */
export function StatusTab({ api, busy, erpName, log, onError, run, status }) {
  const erp = status?.erp ?? {};
  const sync = erp.sync ?? null;

  const onRefreshPartners = useCallback(
    () => run("Refresh partners", api.refreshPartners),
    [api, run],
  );
  // The mirror runs in the background and reports each step to the ERP; the page's
  // polling follows it.
  const onSyncRecords = useCallback(
    () => run("Sync records", api.syncRecords),
    [api, run],
  );
  const onReset = useCallback(() => run("Reset", api.reset), [api, run]);

  return (
    <>
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
        <Button
          isDisabled={busy || !api}
          onPress={onRefreshPartners}
          variant="primary">
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
      <OrderTrace api={api} erpName={erpName} onError={onError} />
      <History api={api} erpName={erpName} onError={onError} />
      {log.length > 0 && <div className="erp-log">{log.join("\n")}</div>}
    </>
  );
}
