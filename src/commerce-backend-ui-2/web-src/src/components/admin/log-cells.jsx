/*
 * The integration log's columns and cells, shared by every table of history records: Activity,
 * and Overview's Needs attention (owner, 2026-10-14: one way to draw a record, wherever it
 * shows). A row is history-view.js's eventRow. A screen picks the columns it shows from
 * LOG_COLUMNS and renders each through LOG_CELLS; a column only it has (Overview's Retry) is
 * its own.
 */
import { AdminStatus } from "#web/components/admin/admin-status.jsx";
import { shortName } from "#web/history-view.js";
import { clockTime, dateText } from "#web/time-view.js";

/** Which way a record went, read before the ERP's name. */
const ARROW = { from: "←", to: "→" };
const ARROW_LABEL = { from: "from", to: "to" };

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

/**
 * The record: in Commerce, as a link to its story, and the ERP's own record for the same thing
 * beneath it. A side that is missing where that is the point says so ("Not paired").
 */
function RecordCell({ row }) {
  const commerce = row.commerce || row.missing.commerce;
  const erp = row.erpRecord || row.missing.erp;
  return (
    <>
      {commerce && (
        <span className={row.commerce ? "adm-link" : "adm-missing"}>
          {commerce}
        </span>
      )}
      {erp && (
        <span className={row.erpRecord ? "adm-under" : "adm-under adm-missing"}>
          {erp}
        </span>
      )}
    </>
  );
}

/** How it ended, and on a problem who stopped it and why, in one line under it. */
function ResultCell({ row }) {
  return (
    <>
      <AdminStatus tone={row.tone}>{row.result}</AdminStatus>
      {row.reason && <span className="adm-reason">{row.reason}</span>}
    </>
  );
}

/** Each log column: its heading and width. The Record column names the row for a reader. */
export const LOG_COLUMNS = Object.freeze({
  date: { id: "date", name: "Date", width: 120 },
  details: { id: "details", name: "Details" },
  erp: { id: "erp", name: "ERP", width: 190 },
  record: { id: "record", isRowHeader: true, name: "Record", width: 250 },
  result: { id: "result", name: "Result", width: 270 },
  time: { id: "time", name: "Time", width: 100 },
});

/** Each log column's cell. */
export const LOG_CELLS = Object.freeze({
  date: (row) => dateText(row.at),
  details: (row) => row.details || null,
  erp: (row, erpInfo) => <ErpCell erpInfo={erpInfo} row={row} />,
  record: (row) => <RecordCell row={row} />,
  result: (row) => <ResultCell row={row} />,
  time: (row) => clockTime(row.at),
});
