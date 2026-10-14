/*
 * The Settings tab's groups, as Stores > Configuration's collapsible groups (admin-config.jsx):
 * the integration's (Orders, Sales organization, Schedules), which every ERP shares, then one
 * group per ERP, under its name, with what it sets for itself and how it is reached (owner,
 * 2026-10-14: an ERP switcher hid which settings were whose).
 */
import { AdminConfigGroup } from "#web/components/admin/admin-config.jsx";
import { AdminFacts } from "#web/components/admin/admin-facts.jsx";
import { ErpName } from "#web/components/controls.jsx";
import { SettingRow } from "#web/components/setting-row.jsx";
import {
  connectionFacts,
  ownsOptions,
  systemValueOf,
} from "#web/settings-copy.js";
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

/** The sales organization every ERP uses unless its own group sets one. */
export function SalesOrgGroup({ row, several }) {
  return (
    <AdminConfigGroup
      note={several ? "The default for every ERP." : undefined}
      title="Sales organization">
      <Rows names={groupNames("salesOrg")} row={row} />
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

/** How the ERP is reached: set by Demo Builder, never the secret. */
function ConnectionFacts({ entry }) {
  const facts = connectionFacts(entry);
  const rows = [
    ["Name", facts.name],
    ["ID", <code key="id">{facts.id}</code>],
    ["Kind", facts.kind],
    ["Address", facts.address],
    ["Credential", facts.credential],
  ].map(([label, value]) => ({ label, values: [value] }));
  return (
    <>
      <h4 className="adm-config-subtitle">Connection</h4>
      <p className="adm-config-note">Set by Demo Builder.</p>
      <AdminFacts label={`${facts.name} connection`} rows={rows} />
    </>
  );
}

/**
 * One ERP's own settings, under its name and color, as the band names it (owner, 2026-10-14):
 * its rows (settings-view.js erpGroupNames), then how it is reached. At a website, where its
 * products and order numbers are not set, its note says where they are.
 * @param {object} props
 * @param {{ id: string, name: string }} props.erp
 * @param {object} [props.entry] its ERP list entry, for its connection
 * @param {string[]} props.names its rows
 * @param {boolean} props.atDefault
 */
export function ErpGroup({ atDefault, colors, entry, erp, names, row }) {
  return (
    <AdminConfigGroup
      note={
        atDefault
          ? undefined
          : "Its products and order numbers are set at Default Config."
      }
      title={<ErpName colors={colors} erp={erp} />}>
      <Rows names={names} row={row} />
      {entry && <ConnectionFacts entry={entry} />}
    </AdminConfigGroup>
  );
}

/**
 * A row maker for a view: each field's row, with its own list choices, "Use Default" box,
 * scope, and the value its blank stands for. `erp` names the ERP in the words; `notSet` offers
 * "Not set" for its ownership (several ERPs). A sales organization's name is offered per
 * website only: its blank is the website's name, which Default Config has none of.
 * @returns {(name: string) => React.ReactNode}
 */
export function rowMaker({
  erp,
  fields,
  notSet,
  onChange,
  onUseDefault,
  problemFor,
  statuses,
  useDefaultFor,
  websiteName,
  websites,
}) {
  return (name) => {
    const field = fields.get(name);
    if (!field || (name === "structure_sales_org_name" && !websiteName)) {
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
        problem={problemFor?.(name)}
        scope={settingScope(name)}
        statuses={statuses}
        systemValue={systemValueOf(name, { erp, websiteName })}
        useDefault={useDefaultFor(name)}
        websites={websites}
      />
    );
  };
}
