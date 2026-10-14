/*
 * The Overview: is it working, and does anything need me? Laid out as Commerce's own Dashboard
 * (owner, 2026-10-14): one search that opens an order's trace, a product or a company in the
 * side panel; today's totals across the top; Needs attention, the log's own table holding only
 * the problems, each with Retry, first because it is what needs a person, and absent when
 * nothing does; then the ERPs and the price publish side by side, each a section as the
 * Admin's record pages draw one. Whether each ERP answers is the band's, so it is not said
 * again here. Filling and resetting the ERPs are Demo Builder's: no Sync or Reset here.
 */
import { useCallback, useState } from "react";

import { AdminButton } from "#web/components/admin/admin-button.jsx";
import { AdminDashboardRow } from "#web/components/admin/admin-dashboard.jsx";
import { AdminFacts } from "#web/components/admin/admin-facts.jsx";
import { AdminRefresh } from "#web/components/admin/admin-refresh.jsx";
import { AdminSection } from "#web/components/admin/admin-section.jsx";
import { AdminTable } from "#web/components/admin/admin-table.jsx";
import { AdminTotals } from "#web/components/admin/admin-totals.jsx";
import { LOG_CELLS, LOG_COLUMNS } from "#web/components/admin/log-cells.jsx";
import { ErpName } from "#web/components/controls.jsx";
import { SearchBox } from "#web/components/search-box.jsx";
import { needsAttention } from "#web/history-view.js";
import { erpRow, todayCounts } from "#web/overview-view.js";
import { nextPublishText, scheduledRunRows } from "#web/scheduled-view.js";
import { clockTime, whenText } from "#web/time-view.js";

/** Today's counts, and what waits to be sent now, as the Dashboard's totals. */
function Today({ counts, erpInfo }) {
  const waiting = erpInfo.erps.filter((erp) => erp.counts?.events > 0);
  const total = waiting.reduce((sum, erp) => sum + erp.counts.events, 0);
  const items = [
    { label: "Orders sent today", value: counts.ordersSent },
    { label: "Updates from the ERPs today", value: counts.erpApplied },
    { label: "Changes to the ERPs today", value: counts.commerceSent },
    {
      foot: waiting
        .map((erp) => `${erp.name}: ${erp.counts.events}`)
        .join(", "),
      label: "Waiting to send now",
      value: total,
    },
  ];
  return <AdminTotals items={items} label="Today" />;
}

const ERP_SIDES = ["Last heard from", "Waiting to send"];

/** What waits for an ERP, and, when it is away, that it goes when the ERP is back. */
function waitingText(erp, waiting) {
  return !erp.reachable && Number(waiting) > 0
    ? `${waiting}, sent when it is back`
    : waiting;
}

/** Each ERP: when it last sent something, and how many of its events wait. */
function Erps({ erpInfo, history, now }) {
  const rows = erpInfo.erps.map((erp) => {
    const row = erpRow(erp, history, now, { onlyErp: !erpInfo.several });
    return {
      key: erp.id,
      label: <ErpName colors={erpInfo.colors} erp={erp} />,
      values: [row.lastUpdate, waitingText(erp, row.waiting)],
    };
  });
  return (
    <AdminSection title={erpInfo.several ? "ERPs" : "ERP"}>
      <AdminFacts label="ERPs" rows={rows} sides={ERP_SIDES} />
    </AdminSection>
  );
}

/** The scheduled price publish: its schedule, next run, last run and last change. */
function PricePublish({ now, onShow, runs }) {
  const toSettings = useCallback(() => onShow("settings", ""), [onShow]);
  const [run] = scheduledRunRows(runs, (iso) => clockTime(iso));
  const next = nextPublishText(runs, now, (iso) => clockTime(iso));
  const rows = [
    ["Schedule", run.schedule],
    ["Next run", next],
    ["Last run", run.lastRun],
    ["Last change", run.lastChange],
  ].map(([label, value]) => ({ label, values: [value] }));
  return (
    <AdminSection
      actions={
        <span className="adm-links">
          <AdminButton onPress={toSettings} variant="tertiary">
            Change the schedule
          </AdminButton>
        </span>
      }
      title="Price publish">
      <AdminFacts label="Price publish" rows={rows} />
    </AdminSection>
  );
}

function RetryButton({ onRetry, retrying, row }) {
  const retryThis = useCallback(() => onRetry(row), [onRetry, row]);
  return (
    <AdminButton isDisabled={retrying !== null} onPress={retryThis}>
      {retrying === row.key ? "Retrying" : "Retry"}
    </AdminButton>
  );
}

/**
 * The log's columns, a "When" for its date and time, and Retry. Details is short and its
 * reasons are long, so Result takes the room (owner, 2026-10-14).
 */
const ATTENTION_COLUMNS = [
  { id: "when", name: "When", width: 110 },
  { ...LOG_COLUMNS.erp, width: 200 },
  LOG_COLUMNS.details,
  { ...LOG_COLUMNS.record, width: 220 },
  { ...LOG_COLUMNS.result, width: 330 },
  { id: "retry", name: "Action", width: 120 },
];

function NeedsAttention({ erpInfo, now, onOpen, onRetry, retrying, rows }) {
  const open = useCallback((row) => onOpen({ ...row.open, row }), [onOpen]);
  const cell = useCallback(
    (row, column) => {
      if (column === "when") {
        return whenText(row.at, now);
      }
      if (column !== "retry") {
        return LOG_CELLS[column](row, erpInfo);
      }
      return row.retriable ? (
        <RetryButton onRetry={onRetry} retrying={retrying} row={row} />
      ) : null;
    },
    [erpInfo, now, onRetry, retrying],
  );
  // As the Admin's grids count their rows. With nothing to fix it is not shown at all: the
  // Admin says nothing when nothing is wrong (owner, 2026-10-14).
  if (rows.length === 0) {
    return null;
  }
  const count =
    rows.length === 1 ? "1 record found" : `${rows.length} records found`;
  return (
    <AdminSection actions={count} title="Needs attention">
      <AdminTable
        cell={cell}
        columns={ATTENTION_COLUMNS}
        label="Needs attention"
        onOpen={open}
        rows={rows}
      />
    </AdminSection>
  );
}

/** Retry one record, remembering which, so its button says so and the others wait. */
function useRetry(api, onChanged, onError) {
  const [retrying, setRetrying] = useState(null);
  const retry = useCallback(
    async (row) => {
      setRetrying(row.key);
      try {
        await api.retry(row.retry);
        await onChanged();
      } catch (e) {
        onError(`Retry failed: ${e.message}`);
      }
      setRetrying(null);
    },
    [api, onChanged, onError],
  );
  return { retry, retrying };
}

/**
 * @param {object} props
 * @param {object[]} props.history the Activity records (erp/history, every ERP's)
 * @param {object[]} props.runs the scheduled runs
 * @param {(target: object) => void} props.onOpen open the side panel
 * @param {(tab: string, erpId: string) => void} props.onShow an ERP's Settings and Activity
 */
export function OverviewTab({
  api,
  erpInfo,
  history,
  now,
  onChanged,
  onError,
  onOpen,
  onShow,
  refresh,
  runs,
}) {
  const { retry, retrying } = useRetry(api, onChanged, onError);
  const rows = needsAttention(history, { erps: erpInfo.erps, now });
  return (
    <>
      <div className="adm-tab-tools adm-tab-tools-top">
        <SearchBox api={api} erpInfo={erpInfo} onOpen={onOpen} />
        <AdminRefresh {...refresh} />
      </div>
      <Today counts={todayCounts(history, now)} erpInfo={erpInfo} />
      <NeedsAttention
        erpInfo={erpInfo}
        now={now}
        onOpen={onOpen}
        onRetry={retry}
        retrying={retrying}
        rows={rows}
      />
      <AdminDashboardRow>
        <Erps erpInfo={erpInfo} history={history} now={now} />
        <PricePublish now={now} onShow={onShow} runs={runs} />
      </AdminDashboardRow>
    </>
  );
}
