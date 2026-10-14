/*
 * Settings: "Settings for [ERP ▾] on [website ▾]", then cards by topic, each setting's label and
 * help on the left and its control on the right; one Save Config in the band. "All ERPs" edits
 * the integration's configuration, every ERP's default; picking an ERP edits only what it sets
 * for itself, on its entry in the ERP list (erp/erps). A website shows only what can differ per
 * website, with Commerce's "Use Default Value". Switching with unsaved changes asks first.
 */
import { useCallback, useEffect, useState } from "react";

import { Alert, ConfirmDialog, Spinner } from "#web/components/controls.jsx";
import {
  ConnectionCard,
  ErpListCard,
  OrdersCard,
  ProductsCard,
  rowMaker,
  SalesOrgCard,
  SchedulesCard,
  WebsiteNote,
} from "#web/components/settings-cards.jsx";
import { cardsAt } from "#web/settings-copy.js";
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

/** The scope bar: which ERP, on which website. */
function ScopeBar({ choices, erpId, erps, onErp, onScope, scopeId, several }) {
  const changeErp = useCallback((event) => onErp(event.target.value), [onErp]);
  const changeScope = useCallback(
    (event) => onScope(event.target.value),
    [onScope],
  );
  return (
    <div className="scope-bar">
      {several ? (
        <>
          <label htmlFor="for-erp">Settings for</label>
          <select
            className="select scope-select"
            id="for-erp"
            onChange={changeErp}
            value={erpId}>
            <option value="">All ERPs</option>
            {erps.map((erp) => (
              <option key={erp.id} value={erp.id}>
                {erp.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <span>
          Settings for <strong>{erps[0]?.name}</strong>
        </span>
      )}
      <label htmlFor="for-website">on</label>
      <select
        aria-label="on website"
        className="select scope-select"
        id="for-website"
        onChange={changeScope}
        value={scopeId}>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The band's right side: unsaved or saved, and Save Config. */
function SaveActions({ changed, onSave, saved, saving }) {
  return (
    <>
      {changed && (
        <span className="dirty-flag">
          <span className="dot warn" />
          Unsaved changes
        </span>
      )}
      {saved && !changed && (
        <span className="saved-flag" role="status">
          Saved
        </span>
      )}
      <button
        className="btn btn-primary"
        disabled={saving}
        onClick={onSave}
        type="button">
        {saving ? "Saving" : "Save Config"}
      </button>
    </>
  );
}

/** The cards of the view, in two columns as the mockup lays them out. */
function Cards({ cards, entries, entry, erpInfo, fields, row }) {
  const card = {
    connection: <ConnectionCard entry={entry ?? entries[0]} key="connection" />,
    erpList: (
      <ErpListCard colors={erpInfo.colors} entries={entries} key="erpList" />
    ),
    orders: <OrdersCard key="orders" row={row} />,
    products: <ProductsCard fields={fields} key="products" row={row} />,
    salesOrg: <SalesOrgCard key="salesOrg" row={row} />,
    schedules: <SchedulesCard fields={fields} key="schedules" row={row} />,
    websiteNote: <WebsiteNote key="websiteNote" />,
  };
  const wide = cards.filter((id) => id === "erpList");
  const narrow = cards.filter((id) => id !== "erpList");
  const [left, right] = entry
    ? [narrow.slice(0, 2), narrow.slice(2)]
    : [
        narrow.filter((_id, i) => i % 2 === 0),
        narrow.filter((_id, i) => i % 2 === 1),
      ];
  return (
    <div className="settings-grid">
      <div className="col">{left.map((id) => card[id])}</div>
      <div className="col">{right.map((id) => card[id])}</div>
      {wide.map((id) => card[id])}
    </div>
  );
}

/**
 * @param {object} props
 * @param {(actions: React.ReactNode, children: React.ReactNode) => React.ReactNode} props.frame
 *   the page frame, with the band's actions
 * @param {object} props.initialPage erp/settings at Default Config, with `confirmStatuses`
 * @param {string} [props.initialErp] the ERP a card's Settings link picked
 * @param {() => Promise<void>} props.onRefresh the page's own Refresh; Settings reads its own
 *   settings again first, and its refresh is off while there are unsaved changes
 */
export function SettingsTab({
  api,
  erpInfo,
  frame,
  initialErp = "",
  initialPage,
  onError,
  onRefresh,
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
  const refresh = useCallback(async () => {
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
    await onRefresh();
  }, [api, onError, onRefresh, onSavedDefault, scopeId, statuses]);

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
  const cards = cardsAt({
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
      {scopesNote && <Alert tone="warn">{scopesNote}</Alert>}
      <ScopeBar
        choices={choices}
        erpId={erpId}
        erps={erpInfo.erps}
        onErp={askErp}
        onScope={askScope}
        scopeId={scopeId}
        several={erpInfo.several}
      />
      {page ? (
        <Cards
          cards={cards}
          entries={entries}
          entry={entry}
          erpInfo={erpInfo}
          fields={fields}
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
    { disabled: changed, onRefresh: refresh },
  );
}
