/*
 * Activity: everything that crossed, newest first, grouped by day. Each row: when, which way,
 * the ERPs it concerns, its type, one sentence, and how it ended; a click opens the order's
 * trace, the product or company side by side, or the record itself in the side panel. Filter by
 * ERP, by type, or to the problems only. Picking one ERP reads that ERP's records from the whole
 * history (erp/history ?erp), not only the newest 100.
 */
import { useCallback, useEffect, useState } from "react";

import { Badge, erpStyle, RowErpChips } from "#web/components/controls.jsx";
import {
  dayGroups,
  eventRow,
  rowMatches,
  shortName,
  TYPES,
} from "#web/history-view.js";
import { clockTime } from "#web/time-view.js";

const ARROWS = {
  from: "M20 12H5m5-6-6 6 6 6",
  reset: "M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5",
  to: "M4 12h15m-5-6 6 6-6 6",
};

/**
 * One filter choice. Picks a value directly, or (`toggle`) flips the field it names — either
 * way its own click handler is built here, from stable props, so no caller writes an inline one.
 */
function FilterChip({
  children,
  className = "",
  filterKey,
  onSelect,
  pressed,
  style,
  toggle = false,
  value,
}) {
  const onClick = useCallback(() => {
    onSelect(filterKey, toggle ? !pressed : value);
  }, [filterKey, onSelect, pressed, toggle, value]);
  return (
    <button
      aria-pressed={pressed}
      className={`filter-chip ${className}`.trim()}
      onClick={onClick}
      style={style}
      type="button">
      {children}
    </button>
  );
}

function Filters({ erpInfo, filters, setFilters }) {
  const onSelect = useCallback(
    (key, value) => setFilters((current) => ({ ...current, [key]: value })),
    [setFilters],
  );
  return (
    <div className="feed-tools">
      <div aria-label="Filter activity" className="filters" role="toolbar">
        {erpInfo.several && (
          <div className="filter-group">
            <span>ERP</span>
            <FilterChip
              filterKey="erp"
              onSelect={onSelect}
              pressed={!filters.erp}
              value="">
              All ERPs
            </FilterChip>
            {erpInfo.erps.map((erp) => (
              <FilterChip
                className="is-erp"
                filterKey="erp"
                key={erp.id}
                onSelect={onSelect}
                pressed={filters.erp === erp.id}
                style={erpStyle(erpInfo.colors, erp.id)}
                value={erp.id}>
                {shortName(erp.name)}
              </FilterChip>
            ))}
          </div>
        )}
        <div className="filter-group">
          <span>Type</span>
          <FilterChip
            filterKey="type"
            onSelect={onSelect}
            pressed={!filters.type}
            value="">
            All
          </FilterChip>
          {TYPES.map((type) => (
            <FilterChip
              filterKey="type"
              key={type.id}
              onSelect={onSelect}
              pressed={filters.type === type.id}
              value={type.id}>
              {type.label}
            </FilterChip>
          ))}
        </div>
        <FilterChip
          className="problems"
          filterKey="problems"
          onSelect={onSelect}
          pressed={filters.problems}
          toggle>
          Problems only
        </FilterChip>
      </div>
    </div>
  );
}

function EventRow({ erpInfo, onOpen, row }) {
  const classes = [
    "event",
    row.direction === "reset" ? "is-reset" : "",
    row.problem ? "is-problem" : "",
  ].filter(Boolean);
  const onClick = useCallback(
    () => onOpen({ ...row.open, row }),
    [onOpen, row],
  );
  return (
    <button className={classes.join(" ")} onClick={onClick} type="button">
      <time dateTime={row.at}>{clockTime(row.at)}</time>
      <span className="dir">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d={ARROWS[row.direction]} />
        </svg>
        {row.directionLabel}
      </span>
      <RowErpChips erpInfo={erpInfo} row={row} />
      <span className="chip chip-type">{row.typeLabel}</span>
      <span className="sentence">
        {row.sentence}
        {row.detail && <small>{row.detail}</small>}
      </span>
      <span className="result">
        <Badge tone={row.tone}>{row.result}</Badge>
        {row.retriable && <span className="retry-hint">Retry</span>}
      </span>
      <span aria-hidden="true" className="chev">
        ›
      </span>
    </button>
  );
}

/** What an empty feed says. */
function emptyFeed(entries, filters) {
  if (entries.length === 0) {
    return "Nothing has crossed yet.";
  }
  return filters.problems && !filters.type
    ? "No problems: everything went through."
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
    type: "",
  });
  const entries = useEntries(api, history, filters.erp, onError);
  const context = { erps: erpInfo.erps, now };
  const rows = entries
    .map((entry) => eventRow(entry, context))
    .filter((row) => rowMatches(row, filters));
  const days = dayGroups(rows, now);
  const endsWithReset = entries.at(-1)?.kind === "reset";
  return (
    <>
      <Filters erpInfo={erpInfo} filters={filters} setFilters={setFilters} />
      <div className="feed">
        {days.map((day) => (
          <section className="day-group" key={day.key}>
            <h3 className="day">
              {day.title} {day.date && <span>{day.date}</span>}
            </h3>
            {day.rows.map((row) => (
              <EventRow
                erpInfo={erpInfo}
                key={row.key}
                onOpen={onOpen}
                row={row}
              />
            ))}
          </section>
        ))}
      </div>
      {days.length === 0 && (
        <p className="feed-empty">{emptyFeed(entries, filters)}</p>
      )}
      {days.length > 0 && (
        <p className="feed-end">
          {endsWithReset
            ? "Nothing earlier: a demo reset clears the activity before it. Records are kept 14 days."
            : "Records are kept 14 days; the newest 100 are listed."}
        </p>
      )}
    </>
  );
}
