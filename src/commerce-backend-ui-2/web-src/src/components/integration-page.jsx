/*
 * The integration's page, as it looks once everything it shows has loaded (MainPage waits for
 * that, so nothing half-drawn is ever on screen): the band with each ERP, the tabs Overview ·
 * Activity · Settings · Data Map, and the side panel. Everything arrives as props, so the page
 * renders against stand-in data in the local preview too.
 */
/* global document */
import { ProgressCircle } from "@react-spectrum/s2/ProgressCircle";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ActivityTab } from "#web/components/activity-tab.jsx";
import { Alert } from "#web/components/controls.jsx";
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

/**
 * What shows until everything the page needs has arrived: MainPage's own Suspense fallback in
 * the Admin, and the local preview's. It is the SAME Spectrum ProgressCircle, laid out the same
 * way, as the Admin SDK's "Connecting to Commerce Admin" spinner that comes just before it, so
 * the two read as one.
 */
export function PageLoading() {
  return (
    <div className="page-loading">
      <ProgressCircle aria-label="Loading the integration" isIndeterminate />
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

/** Nothing to say: a quiet read that fails shows its age under "Checked", not an alert. */
const SILENT = () => undefined;

/**
 * The page's own answers, read again on Refresh, after a Retry, and once when the page comes
 * back on screen. It does not poll: a page that changes under the reader looks broken in a
 * demo, and every read calls each ERP (owner, 2026-10-13). Only Refresh and Retry report a
 * failed read; the quiet one leaves the band's "Checked" time to say how old the page is.
 */
function usePageData(api, initial, onError) {
  const [data, setData] = useState(() => ({
    ...initial,
    loadedAt: new Date(),
  }));
  const [busy, setBusy] = useState(false);
  const readActivity = useCallback(
    async (report = onError) => {
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
        report(`Activity could not be read: ${e.message}`);
      }
    },
    [api, onError],
  );
  const readAll = useCallback(
    async (report) => {
      const status = await api.status();
      setData((current) => ({ ...current, loadedAt: new Date(), status }));
      await readActivity(report);
    },
    [api, readActivity],
  );
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await readAll(onError);
    } catch (e) {
      onError(`The integration could not be read: ${e.message}`);
    }
    setBusy(false);
  }, [onError, readAll]);
  useEffect(() => {
    const quietly = () => {
      if (document.visibilityState === "visible") {
        readAll(SILENT).catch(SILENT);
      }
    };
    document.addEventListener("visibilitychange", quietly);
    return () => document.removeEventListener("visibilitychange", quietly);
  }, [readAll]);
  return { ...data, busy, readActivity, refresh };
}

/**
 * @param {object} props
 * @param {{ status: object, settingsPage: object, history: object[], runs: object[] }}
 *   props.initial what MainPage read before drawing anything
 * @param {string|null} [props.initialError] a message to show under the tabs on first draw
 *   (the first read's soft trouble); the page owns its error state after that
 */
export function IntegrationPage({
  api,
  initial,
  initialError = null,
  initialTab = "overview",
}) {
  const now = useNow();
  const [tab, setTab] = useState(initialTab);
  const [picked, setPicked] = useState({ activity: "", settings: "" });
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState(initialError);
  const data = usePageData(api, initial, setError);
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
  const dismiss = useCallback(() => setError(null), []);

  const attention = needsAttention(data.history, {
    erps: erpInfo.erps,
    now,
  }).length;
  const checked = ago(data.loadedAt.toISOString(), now);
  // `own`: a tab's own refresh, and whether it is off (Settings, with unsaved changes).
  const frame = useCallback(
    (actions, children, own = {}) => (
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
        refresh={{
          busy: data.busy,
          checked,
          disabled: own.disabled,
          onRefresh: own.onRefresh ?? data.refresh,
        }}
        tab={tab}>
        {children}
      </PageFrame>
    ),
    [
      attention,
      checked,
      choose,
      data.busy,
      data.refresh,
      dismiss,
      erpInfo,
      error,
      tab,
    ],
  );
  const openScheduled = useCallback(() => setPanel({ kind: "scheduled" }), []);
  const publish = publishLine(data.runs, now, (iso) => clockTime(iso));
  const shared = { api, erpInfo, now, onError: setError, onOpen: setPanel };
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
        onError={setError}
        onRefresh={data.refresh}
        onSavedDefault={setSettingsPage}
        scopes={settingsPage.scopes}
        scopesNote={settingsPage.scopesNote ?? null}
      />
    );
  } else if (tab === "activity") {
    body = frame(
      <button className="band-link" onClick={openScheduled} type="button">
        Next price publish <strong>{publish.next}</strong>. {publish.last}
      </button>,
      <ActivityTab
        {...shared}
        history={data.history}
        initialErp={picked.activity}
        key={picked.activity}
      />,
    );
  } else if (tab === "data-map") {
    body = frame(
      null,
      <DataMapTab
        {...shared}
        history={data.history}
        scopes={settingsPage.scopes}
      />,
    );
  } else {
    body = frame(
      null,
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
