/*
 * The integration's page, as it looks once everything it shows has loaded (MainPage waits for
 * that, so nothing half-drawn is ever on screen): the band with each ERP, the tabs Overview ·
 * Activity · Settings · Data Map, and the side panel. Everything arrives as props, so the page
 * renders against stand-in data in the local preview too.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { ActivityTab } from "#web/components/activity-tab.jsx";
import { Alert, Spinner } from "#web/components/controls.jsx";
import { DataMapTab } from "#web/components/data-map-tab.jsx";
import { OverviewTab } from "#web/components/overview-tab.jsx";
import { PageFrame } from "#web/components/page-frame.jsx";
import { PanelContent } from "#web/components/panel-content.jsx";
import { SettingsTab } from "#web/components/settings-tab.jsx";
import { needsAttention } from "#web/history-view.js";
import { erpColors, listedErps } from "#web/overview-view.js";
import { publishLine } from "#web/scheduled-view.js";
import { ago, clockTime } from "#web/time-view.js";

const TICK_MS = 30 * 1000;

/** What shows until everything the page needs has arrived: one spinner, nothing half-drawn. */
export function PageLoading() {
  return (
    <div className="erp-loading">
      <Spinner label="Loading the integration" />
    </div>
  );
}

/** The time now, moved on every half minute so "2 minutes ago" stays true. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The page's own answers, read again on Refresh and after a Retry. */
function usePageData(api, initial, onError) {
  const [data, setData] = useState(() => ({
    ...initial,
    loadedAt: new Date(),
  }));
  const [busy, setBusy] = useState(false);
  const readActivity = useCallback(async () => {
    try {
      const [history, scheduled] = await Promise.all([
        api.history(false),
        api.scheduled(),
      ]);
      setData((current) => ({
        ...current,
        history: history.entries ?? [],
        runs: scheduled.scheduled ?? [],
      }));
    } catch (e) {
      onError(`Activity could not be read: ${e.message}`);
    }
  }, [api, onError]);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const status = await api.status();
      setData((current) => ({ ...current, loadedAt: new Date(), status }));
      await readActivity();
    } catch (e) {
      onError(`The integration could not be read: ${e.message}`);
    }
    setBusy(false);
  }, [api, onError, readActivity]);
  return { ...data, busy, readActivity, refresh };
}

function RefreshButton({ busy, onRefresh }) {
  return (
    <button
      className="btn btn-secondary"
      disabled={busy}
      onClick={onRefresh}
      type="button">
      {busy ? "Refreshing" : "Refresh"}
    </button>
  );
}

/**
 * @param {object} props
 * @param {{ status: object, settingsPage: object, history: object[], runs: object[] }}
 *   props.initial what MainPage read before drawing anything
 * @param {string|null} props.error a message to show under the tabs
 * @param {(message: string|null) => void} props.onError
 */
export function IntegrationPage({
  api,
  error,
  initial,
  initialTab = "overview",
  onError,
}) {
  const data = usePageData(api, initial, onError);
  const now = useNow();
  const [tab, setTab] = useState(initialTab);
  const [picked, setPicked] = useState({ activity: "", settings: "" });
  const [panel, setPanel] = useState(null);
  // Default Config's settings as last saved, so the tab shows them when it is opened again.
  const [settingsPage, setSettingsPage] = useState(initial.settingsPage);
  const erpInfo = useMemo(() => {
    const erps = listedErps(data.status);
    return { colors: erpColors(erps), erps, several: erps.length > 1 };
  }, [data.status]);

  const show = useCallback((tabId, erpId) => {
    setPicked((current) => ({ ...current, [tabId]: erpId }));
    setTab(tabId);
  }, []);
  const choose = useCallback((tabId) => {
    setPicked({ activity: "", settings: "" });
    setTab(tabId);
  }, []);
  const closePanel = useCallback(() => setPanel(null), []);
  const dismiss = useCallback(() => onError(null), [onError]);

  const attention = needsAttention(data.history, {
    erps: erpInfo.erps,
    now,
  }).length;
  const frame = useCallback(
    (actions, children) => (
      <PageFrame
        actions={actions}
        attention={attention}
        erpInfo={erpInfo}
        notice={
          error && (
            <Alert onDismiss={dismiss} title="Something went wrong">
              {error}
            </Alert>
          )
        }
        onTab={choose}
        tab={tab}>
        {children}
      </PageFrame>
    ),
    [attention, choose, dismiss, erpInfo, error, tab],
  );
  const openScheduled = useCallback(() => setPanel({ kind: "scheduled" }), []);
  const refresh = <RefreshButton busy={data.busy} onRefresh={data.refresh} />;
  const publish = publishLine(data.runs, now, (iso) => clockTime(iso));
  const shared = { api, erpInfo, now, onError, onOpen: setPanel };
  let body;
  if (tab === "settings") {
    body = (
      <SettingsTab
        api={api}
        erpInfo={erpInfo}
        frame={frame}
        initialErp={picked.settings}
        initialPage={settingsPage}
        key={picked.settings}
        onError={onError}
        onSavedDefault={setSettingsPage}
        scopes={settingsPage.scopes}
        scopesNote={settingsPage.scopesNote ?? null}
      />
    );
  } else if (tab === "activity") {
    body = frame(
      <>
        <button className="band-link" onClick={openScheduled} type="button">
          Next price publish <strong>{publish.next}</strong> · {publish.last}
        </button>
        {refresh}
      </>,
      <ActivityTab
        {...shared}
        history={data.history}
        initialErp={picked.activity}
        key={picked.activity}
      />,
    );
  } else if (tab === "data-map") {
    body = frame(
      <>
        <span className="band-note">
          Checked {ago(data.loadedAt.toISOString(), now)}
        </span>
        {refresh}
      </>,
      <DataMapTab {...shared} />,
    );
  } else {
    body = frame(
      <>
        <span className="band-note">
          Checked {ago(data.loadedAt.toISOString(), now)}
        </span>
        {refresh}
      </>,
      <OverviewTab
        {...shared}
        history={data.history}
        onChanged={data.readActivity}
        onShow={show}
        runs={data.runs}
      />,
    );
  }
  return (
    <>
      {body}
      {panel && (
        <PanelContent
          {...shared}
          onChanged={data.readActivity}
          onClose={closePanel}
          panel={panel}
          runs={data.runs}
        />
      )}
    </>
  );
}
