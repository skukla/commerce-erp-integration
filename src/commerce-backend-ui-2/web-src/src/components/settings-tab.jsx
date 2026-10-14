/*
 * Settings, as Stores > Configuration (owner, 2026-10-14): the Admin's Scope switcher, then the
 * settings in collapsible groups (admin-config.jsx); one Save Config in the band. First the
 * integration's groups, which every ERP shares; then one group per ERP, under its name, with
 * what it sets for itself and how it is reached. An ERP switcher used to choose whose settings
 * showed, and hid which were whose (owner, 2026-10-14). A website shows only what can differ
 * per website, with Commerce's "Use Default Value". Switching scope with unsaved changes asks
 * first, in the Admin's words.
 */
import { useCallback, useEffect, useState } from "react";

import { AdminButton } from "#web/components/admin/admin-button.jsx";
import { AdminNotice } from "#web/components/admin/admin-notice.jsx";
import { AdminRefresh } from "#web/components/admin/admin-refresh.jsx";
import { AdminStatus } from "#web/components/admin/admin-status.jsx";
import { AdminSwitcher } from "#web/components/admin/admin-switcher.jsx";
import { ConfirmDialog, Spinner } from "#web/components/controls.jsx";
import {
  ErpGroup,
  OrdersGroup,
  rowMaker,
  SalesOrgGroup,
  SchedulesGroup,
} from "#web/components/settings-groups.jsx";
import { groupsAt } from "#web/settings-copy.js";
import {
  anyChanges,
  editOf,
  firstGap,
  INTEGRATION,
  settingsTargets,
} from "#web/settings-targets.js";
import {
  ERP_WEBSITE_NAMES,
  erpGroupNames,
  websiteChoices,
  websiteCodeOf,
  websiteOptions,
} from "#web/settings-view.js";

const SCOPE_HINT =
  "Default Config applies to every website unless a website sets its own value.";

/**
 * The "Use Default Value" box, or null for none: an integration setting at a website takes
 * Default Config's; an ERP's sales organization takes the integration's.
 */
function useDefaultLabel(target, name, atDefault) {
  if (target.id !== INTEGRATION) {
    return ERP_WEBSITE_NAMES.has(name) ? "Use Default Value" : null;
  }
  return atDefault ? null : "Use Default Value";
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

/** The scope switcher. A choice's id is "" for Default Config, which a Picker key cannot be. */
function ScopeBar({ choices, onScope, scopeId }) {
  const options = choices.map((c) => ({ id: `s:${c.id}`, label: c.label }));
  const change = useCallback((id) => onScope(id.slice(2)), [onScope]);
  return (
    <AdminSwitcher
      hint={SCOPE_HINT}
      label="Scope"
      onChange={change}
      options={options}
      value={`s:${scopeId}`}
    />
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

/**
 * Save every target with changes, the integration first, each by its own path. A failure stops
 * there: what saved is kept, what did not stays unsaved.
 * @returns {Promise<string[]>} the targets saved
 */
async function saveTargets(api, targets, { scopeId, websiteCode }) {
  const saved = [];
  for (const target of targets) {
    if (Object.keys(target.changes).length === 0) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: one save at a time, so a failure stops the rest
    const answer = await (target.id === INTEGRATION
      ? api.saveSettings(scopeId || undefined, target.changes)
      : api.saveErpSettings(target.id, websiteCode, target.changes));
    saved.push({ answer, id: target.id });
  }
  return saved;
}

/** Changing and saving the edits per target, which the tab holds (`edits`, `setEdits`). */
function useEdits({ api, onError, onSaved, scope, setEdits, targets }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [gap, setGap] = useState(null);
  const change = useCallback(
    (target, name, value) => {
      setSaved(false);
      setGap(null);
      setEdits((all) => ({
        ...all,
        [target.id]: editOf(target, all[target.id] ?? {}, name, value),
      }));
    },
    [setEdits],
  );
  const reset = useCallback(() => {
    setEdits({});
    setSaved(false);
    setGap(null);
  }, [setEdits]);
  const save = useCallback(async () => {
    const missing = firstGap(targets);
    setGap(missing);
    if (missing || !anyChanges(targets)) {
      return;
    }
    setSaving(true);
    const done = [];
    try {
      done.push(...(await saveTargets(api, targets, scope)));
      setSaved(true);
    } catch (e) {
      onError(`Settings could not be saved: ${e.message}`);
    }
    onSaved(done);
    setEdits((all) =>
      Object.fromEntries(
        Object.entries(all).filter(([id]) => !done.some((d) => d.id === id)),
      ),
    );
    setSaving(false);
  }, [api, onError, onSaved, scope, setEdits, targets]);
  return { change, gap, reset, save, saved, saving };
}

/**
 * @param {object} props
 * @param {(actions: React.ReactNode, children: React.ReactNode) => React.ReactNode} props.frame
 *   the page frame, with the band's actions
 * @param {object} props.initialPage erp/settings at Default Config, with `confirmStatuses`
 * @param {{ busy: boolean, updated: string, onRefresh: () => Promise<void> }} props.refresh
 *   the page's own; Settings reads its own settings again first, and is off while there are
 *   unsaved changes
 */
export function SettingsTab(props) {
  const { api, erpInfo, initialPage, onError, onSavedDefault, scopes } = props;
  const [round, setRound] = useState(0);
  const [entries, setEntries] = useErpEntries(api, round);
  const [scopeId, setScopeId] = useState("");
  const [page, setPage] = useScopePage(
    api,
    initialPage,
    scopeId,
    onError,
    round,
  );
  const [statuses] = useState(initialPage.confirmStatuses ?? null);
  const [asked, setAsked] = useState(null);
  const [edits, setEdits] = useState({});
  const choices = websiteChoices(scopes);
  const scopeLevel = choices.find((c) => c.id === scopeId)?.level ?? "global";
  const websiteCode = websiteCodeOf(scopes, scopeId);
  const targets = settingsTargets({
    edits,
    entries,
    erpInfo,
    page,
    scopeLevel,
    websiteCode,
  });
  const onSaved = useCallback(
    (done) => {
      for (const { answer, id } of done) {
        if (id !== INTEGRATION) {
          setEntries((list) =>
            list.map((e) => (e.id === answer.entry.id ? answer.entry : e)),
          );
        } else if (scopeId === "") {
          // The PATCH answers the page without Commerce's statuses; they have not changed.
          onSavedDefault({ ...answer, confirmStatuses: statuses });
        } else {
          setPage(answer);
        }
      }
    },
    [onSavedDefault, scopeId, setEntries, setPage, statuses],
  );
  const editing = useEdits({
    api,
    onError,
    onSaved,
    scope: { scopeId, websiteCode },
    setEdits,
    targets,
  });
  return (
    <SettingsView
      {...props}
      asked={asked}
      choices={choices}
      editing={editing}
      entries={entries}
      page={page}
      scopeId={scopeId}
      scopeLevel={scopeLevel}
      setAsked={setAsked}
      setRound={setRound}
      setScopeId={setScopeId}
      statuses={statuses}
      targets={targets}
    />
  );
}

/** One target's row maker: its fields, its words, its boxes and its refusal. */
function targetRows(target, view) {
  const { atDefault, editing, statuses, websiteName, websites } = view;
  return rowMaker({
    erp: target.erp,
    fields: target.fields,
    notSet: target.id !== INTEGRATION,
    onChange: (name, value) => editing.change(target, name, value),
    onUseDefault: (name) => editing.change(target, name, null),
    problemFor: (name) =>
      editing.gap?.target === target.id && editing.gap.name === name
        ? editing.gap.text
        : undefined,
    statuses,
    useDefaultFor: (name) => useDefaultLabel(target, name, atDefault),
    websiteName,
    websites,
  });
}

/** The integration's groups, then each ERP's. */
function Groups({ atDefault, entries, erpInfo, targets, view }) {
  const [integration, ...erps] = targets;
  const row = targetRows(integration, view);
  const group = {
    orders: <OrdersGroup key="orders" row={row} />,
    salesOrg: (
      <SalesOrgGroup key="salesOrg" row={row} several={erpInfo.several} />
    ),
    schedules: (
      <SchedulesGroup fields={integration.fields} key="schedules" row={row} />
    ),
  };
  // One ERP is the integration target: its group shows the integration's products rows.
  const erpTargets = erpInfo.several
    ? erps
    : [{ ...integration, entry: entries[0], erp: erpInfo.erps[0] }];
  const shape = { atDefault, several: erpInfo.several };
  return (
    <div className="adm-config">
      {groupsAt({ atDefault }).map((id) => group[id])}
      {erpTargets.map((target) => (
        <ErpGroup
          atDefault={atDefault}
          colors={erpInfo.colors}
          entry={target.entry}
          erp={target.erp}
          key={`erp.${target.erp.id}`}
          names={erpGroupNames(shape, target.fields)}
          row={targetRows(target, view)}
        />
      ))}
    </div>
  );
}

/** Switching scope: straight away, or, with unsaved changes, after the Admin's question. */
function useScopeSwitch({ asked, changed, reset, setAsked, setScopeId }) {
  const go = useCallback(
    (scope) => {
      reset();
      setScopeId(scope);
    },
    [reset, setScopeId],
  );
  const askScope = useCallback(
    (scope) => (changed ? setAsked({ scope }) : go(scope)),
    [changed, go, setAsked],
  );
  const cancel = useCallback(() => setAsked(null), [setAsked]);
  const confirm = useCallback(() => {
    go(asked.scope);
    setAsked(null);
  }, [asked, go, setAsked]);
  return { askScope, cancel, confirm };
}

/** Refresh reads the settings again, so it waits for unsaved changes to be saved first. */
function useReread(view) {
  const { api, onError, onSavedDefault, refresh, scopeId, setRound, statuses } =
    view;
  return useCallback(async () => {
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
  }, [api, onError, onSavedDefault, refresh, scopeId, setRound, statuses]);
}

/** The tab as drawn: the scope bar and refresh, the groups, and the switch question. */
function SettingsView(props) {
  const { api, asked, choices, editing, entries, erpInfo, frame, page } = props;
  const { refresh, scopeId, scopeLevel, scopes, scopesNote, setAsked } = props;
  const { onError, onSavedDefault, setRound, setScopeId, statuses, targets } =
    props;
  const changed = anyChanges(targets);
  const atDefault = scopeLevel === "global";
  const { askScope, cancel, confirm } = useScopeSwitch({
    asked,
    changed,
    reset: editing.reset,
    setAsked,
    setScopeId,
  });
  const reread = useReread({
    api,
    onError,
    onSavedDefault,
    refresh,
    scopeId,
    setRound,
    statuses,
  });
  const view = {
    atDefault,
    editing,
    statuses,
    websiteName: atDefault
      ? undefined
      : choices.find((c) => c.id === scopeId)?.label,
    websites: websiteOptions(scopes),
  };
  const actions = (
    <SaveActions
      changed={changed}
      onSave={editing.save}
      saved={editing.saved}
      saving={editing.saving}
    />
  );
  return frame(
    actions,
    <>
      {scopesNote && <AdminNotice tone="warning">{scopesNote}</AdminNotice>}
      <div className="adm-tab-tools">
        <ScopeBar choices={choices} onScope={askScope} scopeId={scopeId} />
        <AdminRefresh
          busy={refresh.busy}
          disabled={changed}
          onRefresh={reread}
          updated={refresh.updated}
        />
      </div>
      {page ? (
        <Groups
          atDefault={atDefault}
          entries={entries}
          erpInfo={erpInfo}
          targets={targets}
          view={view}
        />
      ) : (
        <div className="erp-loading">
          <Spinner label="Reading the settings" />
        </div>
      )}
      {asked && (
        <ConfirmDialog
          message="Please confirm scope switching. All data that hasn't been saved will be lost."
          onCancel={cancel}
          onConfirm={confirm}
          title="Switch scope"
        />
      )}
    </>,
  );
}
