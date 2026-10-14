/*
 * The Settings tab's groups, as Stores > Configuration's collapsible groups (admin-config.jsx):
 * Orders, Sales organization, Products and order numbers, Schedules, the read-only Connection,
 * and with several ERPs the list of ERPs Demo Builder set up.
 */
import { useCallback } from "react";

import { AdminConfigGroup } from "#web/components/admin/admin-config.jsx";
import { AdminFacts } from "#web/components/admin/admin-facts.jsx";
import { AdminNotice } from "#web/components/admin/admin-notice.jsx";
import { AdminTable } from "#web/components/admin/admin-table.jsx";
import { ErpName } from "#web/components/controls.jsx";
import { SettingRow } from "#web/components/setting-row.jsx";
import { connectionFacts, ownsOptions } from "#web/settings-copy.js";
import { groupNames, scheduleNames, settingScope } from "#web/settings-view.js";

/** A group's rows, each field that is shown, in order. */
function Rows({ names, row }) {
  return names.map((name) => row(name)).filter(Boolean);
}

export function OrdersGroup({ row }) {
  return (
    <AdminConfigGroup title="Orders">
      <Rows names={groupNames("orders")} row={row} />
    </AdminConfigGroup>
  );
}

export function SalesOrgGroup({ row }) {
  return (
    <AdminConfigGroup title="Sales organization">
      <Rows names={groupNames("salesOrg")} row={row} />
    </AdminConfigGroup>
  );
}

/** Which products the ERP owns, and its order-number prefix: at Default Config only. */
export function ProductsGroup({ fields, row }) {
  // The attribute and the websites show only under the mode that reads them.
  const mode = fields.get("structure_owns")?.value;
  const hidden = {
    structure_owns_attribute: mode !== "attribute",
    structure_owns_websites: mode !== "websites",
  };
  const names = groupNames("products").filter((name) => !hidden[name]);
  return (
    <AdminConfigGroup title="Products and order numbers">
      <Rows names={names} row={row} />
    </AdminConfigGroup>
  );
}

/** When the scheduled jobs run (AB-38): at Default Config only, for the whole integration. */
export function SchedulesGroup({ fields, row }) {
  return (
    <AdminConfigGroup note="Checked every 5 minutes." title="Schedules">
      <Rows names={scheduleNames(fields)} row={row} />
    </AdminConfigGroup>
  );
}

export function WebsiteNote() {
  return (
    <AdminNotice tone="notice">
      Products and order numbers are set once for every website. Switch to
      Default Config to change them.
    </AdminNotice>
  );
}

/** How the ERP is reached: set by Demo Builder, never the secret. */
export function ConnectionGroup({ entry }) {
  if (!entry) {
    return null;
  }
  const facts = connectionFacts(entry);
  const rows = [
    ["Name", facts.name],
    ["ID", <code key="id">{facts.id}</code>],
    ["Kind", facts.kind],
    ["Address", facts.address],
    ["Credential", facts.credential],
  ].map(([label, value]) => ({ label, values: [value] }));
  return (
    <AdminConfigGroup note="Set by Demo Builder." title="Connection">
      <AdminFacts label="Connection" rows={rows} />
    </AdminConfigGroup>
  );
}

const ERP_LIST_COLUMNS = [
  { id: "name", isRowHeader: true, name: "Name", width: 200 },
  { id: "id", name: "ID", width: 120 },
  { id: "kind", name: "Kind", width: 120 },
  { id: "address", name: "Address" },
  { id: "credential", name: "Credential", width: 320 },
];

/** Every ERP Demo Builder set up, with several ERPs, at All ERPs on Default Config. */
export function ErpListGroup({ colors, entries }) {
  const rows = entries.map((entry) => ({
    ...connectionFacts(entry),
    entry,
    key: entry.id,
  }));
  const cell = useCallback(
    (row, column) => {
      if (column === "name") {
        return <ErpName colors={colors} erp={row.entry} />;
      }
      return column === "id" ? <code>{row.id}</code> : row[column];
    },
    [colors],
  );
  return (
    <AdminConfigGroup note="Set by Demo Builder." title="ERPs">
      <AdminTable
        cell={cell}
        columns={ERP_LIST_COLUMNS}
        label="ERPs"
        rows={rows}
      />
    </AdminConfigGroup>
  );
}

/**
 * A row maker for a view: each field's row, with its own list choices, "Use Default" box and
 * scope. `erp` names the ERP in the words; `notSet` offers "Not set" for its ownership (several
 * ERPs).
 * @returns {(name: string) => React.ReactNode}
 */
export function rowMaker({
  erp,
  fields,
  notSet,
  onChange,
  onUseDefault,
  statuses,
  useDefaultFor,
}) {
  return (name) => {
    const field = fields.get(name);
    if (!field) {
      return null;
    }
    return (
      <SettingRow
        erp={erp}
        field={field}
        key={name}
        onChange={onChange}
        onUseDefault={onUseDefault}
        options={
          name === "structure_owns"
            ? ownsOptions(notSet ? erp : null)
            : field.options
        }
        scope={settingScope(name)}
        statuses={statuses}
        useDefault={useDefaultFor(name)}
      />
    );
  };
}
