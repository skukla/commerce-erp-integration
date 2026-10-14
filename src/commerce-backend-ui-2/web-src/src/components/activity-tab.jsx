/*
 * Activity: everything that crossed, newest first, as one table (components/admin): the date
 * and time, the ERP and which way, what happened in plain words, the record (in Commerce, and
 * in the ERP beneath it), and how it ended (owner, 2026-10-14). A click opens the record's whole
 * story in the side panel. Filter by words, ERP, type, dates, or to the problems only. Picking
 * one ERP reads that ERP's records from the whole history (erp/history ?erp), not only the
 * newest 100.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AdminDateRange,
  AdminPicker,
  AdminSearch,
  AdminSwitch,
} from "#web/components/admin/admin-fields.jsx";
import { AdminFilterBar } from "#web/components/admin/admin-filter-bar.jsx";
import { AdminTable } from "#web/components/admin/admin-table.jsx";
import { LOG_CELLS, LOG_COLUMNS } from "#web/components/admin/log-cells.jsx";
import { useGridFilters } from "#web/components/admin/use-grid-filters.js";
import { eventRow, rowMatches, shortName, TYPES } from "#web/history-view.js";
import { dateText } from "#web/time-view.js";

/** A Picker's id for "every ERP" or "every type": the filters themselves use "". */
const EVERY = "all";

/**
 * The log's columns: when, which ERP, what happened, the record, and how it ended. The words
 * say what kind of event it was, so there is no Event column; the Type filter groups them.
 */
const COLUMNS = ["date", "time", "erp", "details", "record", "result"].map(
  (id) => LOG_COLUMNS[id],
);

/** Every filter off. */
const NO_FILTERS = {
  erp: "",
  from: "",
  problems: false,
  text: "",
  to: "",
  type: "",
};

const TYPE_OPTIONS = [
  { id: EVERY, label: "All types" },
  ...TYPES.map((type) => ({ id: type.id, label: type.label })),
];

/** A day (YYYY-MM-DD) as the grid writes dates: "Oct 14, 2026". */
const dayText = (day) => dateText(`${day}T12:00:00`);

/** The filters in force, as the Active filters row's chips. */
function activeChips(filters, erpInfo, drop) {
  const chips = [];
  if (filters.from || filters.to) {
    // As the Admin's chips read a range: "from - to", an open end as "..." (Magento_Ui chips).
    const end = (day) => (day ? dayText(day) : "...");
    const days =
      filters.from === filters.to
        ? dayText(filters.from)
        : `${end(filters.from)} - ${end(filters.to)}`;
    chips.push({
      id: "date",
      label: `Date: ${days}`,
      onRemove: drop({ from: "", to: "" }),
    });
  }
  if (filters.erp) {
    const erp = erpInfo.erps.find((e) => e.id === filters.erp);
    chips.push({
      id: "erp",
      label: `ERP: ${erp ? shortName(erp.name) : filters.erp}`,
      onRemove: drop({ erp: "" }),
    });
  }
  if (filters.type) {
    const type = TYPES.find((t) => t.id === filters.type);
    chips.push({
      id: "type",
      label: `Type: ${type?.label ?? filters.type}`,
      onRemove: drop({ type: "" }),
    });
  }
  if (filters.problems) {
    chips.push({
      id: "problems",
      label: "Problems only",
      onRemove: drop({ problems: false }),
    });
  }
  return chips;
}

/** The fields in the Filters panel, bound to its draft. */
function FilterFields({ draft, erpInfo, setDraft }) {
  const set = useCallback(
    (key) => (value) =>
      setDraft((current) => ({
        ...current,
        [key]: value === EVERY ? "" : value,
      })),
    [setDraft],
  );
  const onErp = useMemo(() => set("erp"), [set]);
  const onType = useMemo(() => set("type"), [set]);
  const onProblems = useMemo(() => set("problems"), [set]);
  const onDates = useCallback(
    (from, to) => setDraft((current) => ({ ...current, from, to })),
    [setDraft],
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
    <>
      <AdminDateRange from={draft.from} onChange={onDates} to={draft.to} />
      {erpInfo.several && (
        <AdminPicker
          label="ERP"
          onChange={onErp}
          options={erps}
          value={draft.erp || EVERY}
        />
      )}
      <AdminPicker
        label="Type"
        onChange={onType}
        options={TYPE_OPTIONS}
        value={draft.type || EVERY}
      />
      <AdminSwitch isSelected={draft.problems} onChange={onProblems}>
        Problems only
      </AdminSwitch>
    </>
  );
}

/** The grid's filters: a search, the Filters panel, the chips in force, and its refresh. */
function Filters({ erpInfo, grid, refresh }) {
  return (
    <AdminFilterBar
      active={activeChips(grid.filters, erpInfo, grid.drop)}
      fields={
        <FilterFields
          draft={grid.draft}
          erpInfo={erpInfo}
          setDraft={grid.setDraft}
        />
      }
      onApply={grid.apply}
      onClearAll={grid.clearAll}
      onOpen={grid.openPanel}
      refresh={refresh}
      search={
        <AdminSearch
          label="Search activity"
          onChange={grid.setText}
          placeholder="Search by order, SKU or company"
          value={grid.filters.text}
        />
      }
    />
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
  if (filters.from) {
    return "No activity on these dates.";
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
  refresh,
}) {
  const [start] = useState(() => ({
    ...NO_FILTERS,
    erp: erpInfo.several ? initialErp : "",
  }));
  const grid = useGridFilters(NO_FILTERS, start);
  const { filters } = grid;
  const entries = useEntries(api, history, filters.erp, onError);
  const rows = entries
    .map((entry) => eventRow(entry, { erps: erpInfo.erps, now }))
    .filter((row) => rowMatches(row, filters));
  const endsWithReset = entries.at(-1)?.kind === "reset";
  const open = useCallback((row) => onOpen({ ...row.open, row }), [onOpen]);
  const cell = useCallback(
    (row, column) => LOG_CELLS[column](row, erpInfo),
    [erpInfo],
  );
  return (
    <>
      <Filters erpInfo={erpInfo} grid={grid} refresh={refresh} />
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
