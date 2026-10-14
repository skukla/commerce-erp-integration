/*
 * Activity: everything that crossed, newest first, as one table (components/admin): when, the
 * ERP and which way, its type, the record, and how it ended. Each fact is said once: the
 * record's second line shows only when something went wrong (owner, 2026-10-14). A click opens
 * the order's trace, the product or company side by side, or the record itself in the side
 * panel. Filter by ERP, by type, or to the problems only. Picking one ERP reads that ERP's
 * records from the whole history (erp/history ?erp), not only the newest 100.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AdminPicker,
  AdminSearch,
  AdminSwitch,
} from "#web/components/admin/admin-fields.jsx";
import { AdminStatus } from "#web/components/admin/admin-status.jsx";
import { AdminTable } from "#web/components/admin/admin-table.jsx";
import { eventRow, rowMatches, shortName, TYPES } from "#web/history-view.js";
import { whenText } from "#web/time-view.js";

/** A Picker's id for "every ERP" or "every type": the filters themselves use "". */
const EVERY = "all";

const COLUMNS = [
  { id: "when", name: "Time", width: 130 },
  { id: "erp", name: "ERP", width: 210 },
  { id: "type", name: "Type", width: 150 },
  { id: "record", isRowHeader: true, name: "Record" },
  { id: "result", name: "Result", width: 190 },
];

/** Which way a record went, read before the ERP's name. */
const ARROW = { from: "←", to: "→" };
const ARROW_LABEL = { from: "from", to: "to" };

function Filters({ erpInfo, filters, setFilters }) {
  const pick = useCallback(
    (key) => (id) =>
      setFilters((current) => ({ ...current, [key]: id === EVERY ? "" : id })),
    [setFilters],
  );
  const onErp = useMemo(() => pick("erp"), [pick]);
  const onType = useMemo(() => pick("type"), [pick]);
  const onProblems = useCallback(
    (on) => setFilters((current) => ({ ...current, problems: on })),
    [setFilters],
  );
  const onText = useCallback(
    (text) => setFilters((current) => ({ ...current, text })),
    [setFilters],
  );
  const erps = useMemo(
    () => [
      { id: EVERY, label: "All ERPs" },
      ...erpInfo.erps.map((erp) => ({
        id: erp.id,
        label: shortName(erp.name),
      })),
    ],
    [erpInfo.erps],
  );
  return (
    <div aria-label="Filter activity" className="adm-toolbar" role="toolbar">
      <AdminSearch
        label="Search activity"
        onChange={onText}
        placeholder="Order, SKU or company"
        value={filters.text}
      />
      {erpInfo.several && (
        <AdminPicker
          label="ERP"
          onChange={onErp}
          options={erps}
          value={filters.erp || EVERY}
        />
      )}
      <AdminPicker
        label="Type"
        onChange={onType}
        options={TYPE_OPTIONS}
        value={filters.type || EVERY}
      />
      <AdminSwitch isSelected={filters.problems} onChange={onProblems}>
        Problems only
      </AdminSwitch>
    </div>
  );
}

const TYPE_OPTIONS = [
  { id: EVERY, label: "All types" },
  ...TYPES.map((type) => ({ id: type.id, label: type.label })),
];

/** The ERP cell: which way, then the ERPs by name. */
function ErpCell({ erpInfo, row }) {
  if (row.everyErp) {
    return erpInfo.several ? "All ERPs" : erpInfo.erps[0].name;
  }
  if (row.unnamed) {
    return <span className="adm-muted">Not named</span>;
  }
  const names = row.erpIds
    .map((id) => erpInfo.erps.find((erp) => erp.id === id))
    .filter(Boolean)
    .map((erp) => shortName(erp.name))
    .join(", ");
  const arrow = ARROW[row.direction];
  return (
    <>
      {arrow && (
        <span
          aria-label={ARROW_LABEL[row.direction]}
          className="adm-arrow"
          role="img">
          {arrow}
        </span>
      )}
      {names}
    </>
  );
}

/** The record: its sentence, and why when it did not get through. */
function RecordCell({ row }) {
  return (
    <>
      {row.sentence}
      {row.problem && row.detail && (
        <span className="adm-second">{row.detail}</span>
      )}
    </>
  );
}

/** What an empty feed says. */
function emptyFeed(entries, filters) {
  if (entries.length === 0) {
    return "No activity yet.";
  }
  if (filters.text) {
    return `Nothing matches “${filters.text}”.`;
  }
  return filters.problems && !filters.type
    ? "No problems."
    : "Nothing matches these filters.";
}

/** The records to list: every ERP's as the page read them, or one ERP's whole history. */
function useEntries(api, history, erp, onError) {
  const [own, setOwn] = useState(null);
  useEffect(() => {
    if (!erp) {
      setOwn(null);
      return;
    }
    let current = true;
    api
      .history(false, erp)
      .then((answer) => current && setOwn(answer.entries ?? []))
      .catch((e) => onError(`Activity could not be read: ${e.message}`));
    return () => {
      current = false;
    };
  }, [api, erp, history, onError]);
  return erp && own ? own : history;
}

/**
 * @param {object} props
 * @param {string} [props.initialErp] the ERP a card's Activity link picked
 */
export function ActivityTab({
  api,
  erpInfo,
  history,
  initialErp = "",
  now,
  onError,
  onOpen,
}) {
  const [filters, setFilters] = useState({
    erp: erpInfo.several ? initialErp : "",
    problems: false,
    text: "",
    type: "",
  });
  const entries = useEntries(api, history, filters.erp, onError);
  const rows = entries
    .map((entry) => eventRow(entry, { erps: erpInfo.erps, now }))
    .filter((row) => rowMatches(row, filters));
  const endsWithReset = entries.at(-1)?.kind === "reset";
  const open = useCallback((row) => onOpen({ ...row.open, row }), [onOpen]);
  const cell = useCallback(
    (row, column) => {
      switch (column) {
        case "when":
          return whenText(row.at, now);
        case "erp":
          return <ErpCell erpInfo={erpInfo} row={row} />;
        case "type":
          return row.typeLabel;
        case "result":
          return <AdminStatus tone={row.tone}>{row.result}</AdminStatus>;
        default:
          return <RecordCell row={row} />;
      }
    },
    [erpInfo, now],
  );
  return (
    <>
      <Filters erpInfo={erpInfo} filters={filters} setFilters={setFilters} />
      <AdminTable
        cell={cell}
        columns={COLUMNS}
        empty={<p className="adm-empty">{emptyFeed(entries, filters)}</p>}
        label="Activity"
        onOpen={open}
        rows={rows}
      />
      {rows.length > 0 && (
        <p className="adm-foot">
          {endsWithReset
            ? "Earlier activity was cleared by a demo reset."
            : "Kept 14 days. The newest 100 are shown."}
        </p>
      )}
    </>
  );
}
