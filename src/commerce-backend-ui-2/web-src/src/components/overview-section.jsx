/*
 * How the integration stands: what the ERP holds (with several ERPs, one row per ERP with
 * whether it can be used and why not), and one record as both systems hold it.
 * The connection map from the redesign replaces the counts in its second slice. Filling and
 * resetting the ERP are Demo Builder's (AB-26y): the integration no longer copies Commerce
 * into the ERP, so this page has no Sync or Reset buttons.
 */
import { Heading, Text } from "@react-spectrum/s2";

import { Lookup } from "#web/components/lookup.jsx";
import { Stat } from "#web/components/stat.jsx";
import { overviewRows } from "#web/overview-view.js";

const PRODUCT = { kind: "sku", label: "SKU" };
const COMPANY = { kind: "company", label: "Commerce company id" };

/** Several ERPs: one row per ERP, with whether it can be used and its own figures. */
function ErpsTable({ erps }) {
  return (
    <table className="erp-history-table">
      <thead>
        <tr>
          <th>ERP</th>
          <th>Status</th>
          <th>Products</th>
          <th>Business partners</th>
          <th>Sales orders</th>
          <th>ERP events pending</th>
          <th>Last import</th>
          <th>Last wipe</th>
        </tr>
      </thead>
      <tbody>
        {overviewRows(erps).map((row) => (
          <tr key={row.id}>
            <td>{row.name}</td>
            <td>{row.state}</td>
            <td>{String(row.products)}</td>
            <td>{String(row.businessPartners)}</td>
            <td>{String(row.salesOrders)}</td>
            <td>{String(row.events)}</td>
            <td>{row.lastImportAt}</td>
            <td>{row.lastWipeAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One ERP: its figures as cards, as before several ERPs. */
function OneErpFigures({ erp, erpName, status }) {
  return (
    <>
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
    </>
  );
}

export function OverviewSection({ api, erpName, erps, onError, status }) {
  const erp = status?.erp ?? {};
  return (
    <section aria-labelledby="erp-overview-heading" className="erp-section">
      <Heading id="erp-overview-heading" level={2}>
        Overview
      </Heading>
      {erps ? (
        <>
          <ErpsTable erps={erps} />
          <div className="erp-grid">
            <Stat
              label="Company changes to undo on reset"
              value={status?.ledger?.entries ?? "–"}
            />
          </div>
        </>
      ) : (
        <OneErpFigures erp={erp} erpName={erpName} status={status} />
      )}
      <Heading level={3}>Look up a record in both systems</Heading>
      <div className="erp-lookups">
        <Lookup
          api={api}
          erpName={erpName}
          erps={erps}
          lookup={PRODUCT}
          onError={onError}
        />
        <Lookup
          api={api}
          erpName={erpName}
          erps={erps}
          lookup={COMPANY}
          onError={onError}
        />
      </div>
    </section>
  );
}
