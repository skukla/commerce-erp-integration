/*
 * Settings, as Stores > Configuration (owner, 2026-10-14): which ERP and which scope, then the
 * settings in collapsible groups by topic, each a Configuration row (admin-config.jsx); one
 * Save Config in the band. "All ERPs" edits the integration's configuration, every ERP's
 * default; picking an ERP edits only what it sets for itself, on its entry in the ERP list
 * (erp/erps). A website shows only what can differ per website, with Commerce's "Use Default
 * Value". Switching with unsaved changes asks first.
 */
import { useCallback, useEffect, useState } from "react";

import { AdminButton } from "#web/components/admin/admin-button.jsx";
import { AdminPicker } from "#web/components/admin/admin-fields.jsx";
import { AdminNotice } from "#web/components/admin/admin-notice.jsx";
import { AdminRefresh } from "#web/components/admin/admin-refresh.jsx";
import { AdminStatus } from "#web/components/admin/admin-status.jsx";
import { ConfirmDialog, Spinner } from "#web/components/controls.jsx";
import {
  ConnectionGroup,
  ErpListGroup,
  OrdersGroup,
  ProductsGroup,
  rowMaker,
  SalesOrgGroup,
  SchedulesGroup,
  WebsiteNote,
} from "#web/components/settings-groups.jsx";
import { groupsAt } from "#web/settings-copy.js";
import { erpFields, integrationFields } from "#web/settings-fields.js";
import {
  ERP_WEBSITE_NAMES,
  erpValues,
  pendingChanges,
  websiteChoices,
  websiteCodeOf,
} from "#web/settings-view.js";

/** An ERP's products and order-number settings are its own or not set: "" is not set. */
const EMPTY_IS_UNSET = new Set([
  "structure_order_prefix",
  "structure_owns",
  "structure_owns_attribute",
  "structure_owns_websites",
]);

/** The fields as shown: an ERP's own, or the integration's at the scope. */
function shownFields(page, entry, values, edits, scopeLevel) {
  if (!page) {
    return new Map();
  }
  return entry
    ? erpFields(page, values, edits)
    : integrationFields(page, edits, scopeLevel);
}

/**
 * The "Use Default" box's label, or null for none: at a website, the wider value is Default
 * Config's; for one ERP at Default Config, it is every ERP's (the integration's).
 */
function useDefaultLabel(name, forErp, atDefault) {
  if (forErp && !ERP_WEBSITE_NAMES.has(name)) {
    return null;
  }
  if (atDefault) {
    return forErp ? "Same as All ERPs" : null;
  }
  return "Use Default Value";
}

/** The ERP list with each ERP's own settings and connection, read again each `round`. */
function useErpEntries(api, round) {
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    api
      .erps()
      .then((answer) => setEntries(answer.entries ?? []))
      .catch(() => setEntries([]));
  }, [api, round]);
  return [entries, setEntries];
}

/**
 * The page at a scope: Default Config as the page holds it, a website read when picked and
 * again each `round` (Refresh).
 */
function useScopePage(api, initialPage, scopeId, onError, round) {
  const [page, setPage] = useState(initialPage);
  useEffect(() => {
    if (scopeId === "") {
      setPage(initialPage);
      return;
    }
    setPage(null);
    api
      .settings(scopeId)
      .then(setPage)
      .catch((e) => onError(`Settings could not be read: ${e.message}`));
  }, [api, initialPage, onError, scopeId, round]);
  return [page, setPage];
}

/** An ERP Picker's id for "every ERP": a collection's keys cannot be "". */
const ALL_ERPS = "all";

/** Which ERP, and which scope: the Configuration page's scope switcher, beside the ERP's. */
function ScopeBar({ choices, erpId, erps, onErp, onScope, scopeId, several }) {
  const erpOptions = [
    { id: ALL_ERPS, label: "All ERPs" },
    ...erps.map((erp) => ({ id: erp.id, label: erp.name })),
  ];
  // A choice's id is "" for Default Config; the Picker's is the label's own key.
  const scopeOptions = choices.map((c) => ({
    id: `s:${c.id}`,
    label: c.label,
  }));
  const changeErp = useCallback(
    (id) => onErp(id === ALL_ERPS ? "" : id),
    [onErp],
  );
  const changeScope = useCallback((id) => onScope(id.slice(2)), [onScope]);
  return (
    <div className="adm-scope-bar">
      {several && (
        <AdminPicker
          label="ERP"
          onChange={changeErp}
          options={erpOptions}
          value={erpId || ALL_ERPS}
        />
      )}
      <AdminPicker
        label="Scope"
        onChange={changeScope}
        options={scopeOptions}
        value={`s:${scopeId}`}
      />
    </div>
  );
}

/** The band's right side: unsaved or saved, and Save Config. */
function SaveActions({ changed, onSave, saved, saving }) {
  return (
    <>
      {changed && <AdminStatus tone="warn">Unsaved changes</AdminStatus>}
      {saved && !changed && (
        <span role="status">
          <AdminStatus tone="ok">Saved</AdminStatus>
        </span>
      )}
      <AdminButton isDisabled={saving} onPress={onSave} variant="primary">
        {saving ? "Saving" : "Save Config"}
      </AdminButton>
    </>
  );
}

/** The groups of the view, one under another, as the Configuration page lists them. */
function Groups({ entries, entry, erpInfo, fields, groups, row }) {
  const group = {
    connection: (
      <ConnectionGroup entry={entry ?? entries[0]} key="connection" />
    ),
    erpList: (
      <ErpListGroup colors={erpInfo.colors} entries={entries} key="erpList" />
    ),
    orders: <OrdersGroup key="orders" row={row} />,
    products: <ProductsGroup fields={fields} key="products" row={row} />,
    salesOrg: <SalesOrgGroup key="salesOrg" row={row} />,
    schedules: <SchedulesGroup fields={fields} key="schedules" row={row} />,
    websiteNote: <WebsiteNote key="websiteNote" />,
  };
  return <div className="adm-config">{groups.map((id) => group[id])}</div>;
}

/**
 * @param {object} props
 * @param {(actions: React.ReactNode, children: React.ReactNode) => React.ReactNode} props.frame
 *   the page frame, with the band's actions
 * @param {object} props.initialPage erp/settings at Default Config, with `confirmStatuses`
 * @param {string} [props.initialErp] the ERP a card's Settings link picked
 * @param {{ busy: boolean, updated: string, onRefresh: () => Promise<void> }} props.refresh
 *   the page's own; Settings reads its own settings again first, and is off while there are
 *   unsaved changes
 */
export function SettingsTab({
  api,
  erpInfo,
  frame,
  initialErp = "",
  initialPage,
  onError,
  refresh,
  onSavedDefault,
  scopes,
  scopesNote,
}) {
  const [round, setRound] = useState(0);
  const [entries, setEntries] = useErpEntries(api, round);
  const [erpId, setErpId] = useState(erpInfo.several ? initialErp : "");
  const [scopeId, setScopeId] = useState("");
  const [page, setPage] = useScopePage(
    api,
    initialPage,
    scopeId,
    onError,
    round,
  );
  const [statuses] = useState(initialPage.confirmStatuses ?? null);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [asked, setAsked] = useState(null);

  const choices = websiteChoices(scopes);
  const scopeLevel = choices.find((c) => c.id === scopeId)?.level ?? "global";
  const atDefault = scopeLevel === "global";
  const entry = erpId
    ? entries.find((candidate) => candidate.id === erpId)
    : null;
  const websiteCode = websiteCodeOf(scopes, scopeId);
  const values = entry
    ? erpValues(entry, websiteCode, page?.values)
    : page?.values;
  const changes = pendingChanges(values, edits);
  const changed = Object.keys(changes).length > 0;

  const go = useCallback((next) => {
    setEdits({});
    setSaved(false);
    if (next.erp !== undefined) {
      setErpId(next.erp);
    }
    if (next.scope !== undefined) {
      setScopeId(next.scope);
    }
  }, []);
  const ask = useCallback(
    (next) => (changed ? setAsked(next) : go(next)),
    [changed, go],
  );
  const askErp = useCallback((erp) => ask({ erp }), [ask]);
  const askScope = useCallback((scope) => ask({ scope }), [ask]);
  const cancelSwitch = useCallback(() => setAsked(null), []);
  const confirmSwitch = useCallback(() => {
    go(asked);
    setAsked(null);
  }, [asked, go]);
  const onChange = useCallback(
    (name, value) => {
      setSaved(false);
      const unset = entry && EMPTY_IS_UNSET.has(name) && value === "";
      setEdits((current) => ({ ...current, [name]: unset ? null : value }));
    },
    [entry],
  );
  const onUseDefault = useCallback((name) => {
    setSaved(false);
    setEdits((current) => ({ ...current, [name]: null }));
  }, []);
  const save = useCallback(async () => {
    if (!changed) {
      return;
    }
    setSaving(true);
    try {
      if (entry) {
        const answer = await api.saveErpSettings(
          entry.id,
          websiteCode,
          changes,
        );
        setEntries((list) =>
          list.map((e) => (e.id === answer.entry.id ? answer.entry : e)),
        );
      } else {
        const answer = await api.saveSettings(scopeId || undefined, changes);
        if (scopeId === "") {
          // The PATCH answers the page without Commerce's statuses; they have not changed.
          onSavedDefault({ ...answer, confirmStatuses: statuses });
        } else {
          setPage(answer);
        }
      }
      setEdits({});
      setSaved(true);
    } catch (e) {
      onError(`Settings could not be saved: ${e.message}`);
    }
    setSaving(false);
  }, [
    api,
    changed,
    changes,
    entry,
    onError,
    onSavedDefault,
    scopeId,
    setEntries,
    setPage,
    statuses,
    websiteCode,
  ]);

  // Refresh reads the settings again, so it waits for unsaved changes to be saved first.
  const reread = useCallback(async () => {
    setSaved(false);
    setRound((n) => n + 1);
    if (scopeId === "") {
      try {
        const answer = await api.settings();
        onSavedDefault({ ...answer, confirmStatuses: statuses });
      } catch (e) {
        onError(`Settings could not be read: ${e.message}`);
      }
    }
    await refresh.onRefresh();
  }, [api, onError, onSavedDefault, refresh, scopeId, statuses]);

  const fields = shownFields(page, entry, values, edits, scopeLevel);
  const shownErp = entry ?? (erpInfo.several ? null : erpInfo.erps[0]);
  const row = rowMaker({
    erp: shownErp,
    fields,
    notSet: Boolean(entry),
    onChange,
    onUseDefault,
    statuses,
    useDefaultFor: (name) => useDefaultLabel(name, Boolean(entry), atDefault),
  });
  const groups = groupsAt({
    atDefault,
    erp: Boolean(entry),
    several: erpInfo.several,
  });
  const actions = (
    <SaveActions
      changed={changed}
      onSave={save}
      saved={saved}
      saving={saving}
    />
  );
  return frame(
    actions,
    <>
      {scopesNote && <AdminNotice tone="warning">{scopesNote}</AdminNotice>}
      <div className="adm-tab-tools">
        <ScopeBar
          choices={choices}
          erpId={erpId}
          erps={erpInfo.erps}
          onErp={askErp}
          onScope={askScope}
          scopeId={scopeId}
          several={erpInfo.several}
        />
        <AdminRefresh
          busy={refresh.busy}
          disabled={changed}
          onRefresh={reread}
          updated={refresh.updated}
        />
      </div>
      {page ? (
        <Groups
          entries={entries}
          entry={entry}
          erpInfo={erpInfo}
          fields={fields}
          groups={groups}
          row={row}
        />
      ) : (
        <div className="erp-loading">
          <Spinner label="Reading the settings" />
        </div>
      )}
      {asked && (
        <ConfirmDialog
          message="Unsaved changes will be lost."
          onCancel={cancelSwitch}
          onConfirm={confirmSwitch}
          title="Switch scope?"
        />
      )}
    </>,
  );
}
