/*
 * How the integration stands: what the ERP holds, one record as both systems hold it, and
 * the controls that fill or reset the ERP. The connection map from the redesign replaces the
 * counts in its second slice; filling and reset move to Demo Builder (AB-26y).
 */
import { Button, Heading, Text } from "@react-spectrum/s2";
import { useCallback } from "react";

import { Lookup } from "#web/components/lookup.jsx";
import { Stat } from "#web/components/stat.jsx";
import { isSyncActive, SyncProgress } from "#web/components/sync-progress.jsx";

const PRODUCT = { kind: "sku", label: "SKU" };
const COMPANY = { kind: "company", label: "Commerce company id" };

export function OverviewSection({
  api,
  busy,
  erpName,
  log,
  onError,
  run,
  status,
}) {
  const erp = status?.erp ?? {};
  const sync = erp.sync ?? null;
  const onRefreshPartners = useCallback(
    () => run("Refresh partners", api.refreshPartners),
    [api, run],
  );
  const onSyncRecords = useCallback(
    () => run("Sync records", api.syncRecords),
    [api, run],
  );
  const onReset = useCallback(() => run("Reset", api.reset), [api, run]);

  return (
    <section aria-labelledby="erp-overview-heading" className="erp-section">
      <Heading id="erp-overview-heading" level={2}>
        Overview
      </Heading>
      <div className="erp-grid">
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
        Last import into {erpName}: {erp.lastImportAt || "never"}. Last wipe:{" "}
        {erp.lastWipeAt || "never"}.
      </Text>
      <Heading level={3}>Look up a record in both systems</Heading>
      <div className="erp-lookups">
        <Lookup
          api={api}
          erpName={erpName}
          lookup={PRODUCT}
          onError={onError}
        />
        <Lookup
          api={api}
          erpName={erpName}
          lookup={COMPANY}
          onError={onError}
        />
      </div>
      <Heading level={3}>Records</Heading>
      <div className="erp-actions">
        <Button isDisabled={busy} onPress={onRefreshPartners} variant="primary">
          Refresh partners from Commerce
        </Button>
        <Button
          isDisabled={busy || isSyncActive(sync)}
          onPress={onSyncRecords}
          variant="secondary">
          Sync records to {erpName}
        </Button>
        <Button isDisabled={busy} onPress={onReset} variant="negative">
          Reset ERP records
        </Button>
      </div>
      <SyncProgress erpName={erpName} sync={sync} />
      {log.length > 0 && <div className="erp-log">{log.join("\n")}</div>}
    </section>
  );
}
