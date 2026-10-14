/*
 * The Data Map: Commerce's own word for a business object beside what each ERP calls it, with a
 * real record in every cell (the owner-approved mockup, preview/mockups/data-map.html). The
 * records are read live, the newest of each kind (use-live-map.js); until 2026-10-13 they were
 * fixed examples that went stale. It shows how a pair lines up; Overview and Activity already
 * report today's status, so this view carries no health or problem state of its own. Click a
 * cell to open that record.
 */
import { useCallback, useMemo } from "react";

import { ErpName } from "#web/components/controls.jsx";
import { useLiveMap } from "#web/components/use-live-map.js";
import {
  arrowPathKey,
  MAP_ARROW_PATHS,
  MAP_ENTRIES,
  MAP_ICON_PATHS,
} from "#web/data-map-view.js";

function MapIcon({ entryId }) {
  return (
    <span className="map-icon">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d={MAP_ICON_PATHS[entryId]} />
      </svg>
    </span>
  );
}

/** The arrow for a pair, always drawn from Commerce (on the left) toward the ERPs. */
function MapArrow({ dir, moves }) {
  return (
    <span className="map-arrow">
      <svg
        aria-hidden="true"
        className="dm-svg"
        data-dir={dir}
        viewBox="0 0 160 20">
        <path d={MAP_ARROW_PATHS[arrowPathKey(dir)]} />
      </svg>
      <span>{moves}</span>
    </span>
  );
}

/** The grid's head row: Commerce, then a chip per ERP the project has — one or two. */
function MapGridHead({ colors, erps }) {
  return (
    <div className="mg-head">
      <span className="map-col map-col-c">Commerce</span>
      <span />
      {erps.map((erp) => (
        <span key={erp.id}>
          <ErpName colors={colors} erp={erp} />
        </span>
      ))}
    </div>
  );
}

/** One example cell: a record if there is one to open, otherwise a plain dash. */
function ExampleCell({ cell, onOpen }) {
  const [value, note, open] = cell;
  const isEmpty = value === null || value === undefined;
  const click = useCallback(() => onOpen(open), [onOpen, open]);
  if (!open) {
    return (
      <span className={isEmpty ? "ex-cell is-empty" : "ex-cell"}>
        <strong>{isEmpty ? "—" : value}</strong>
        <small>{note}</small>
      </span>
    );
  }
  return (
    <button className="ex-cell" onClick={click} type="button">
      <strong>{value}</strong>
      <small>{note}</small>
    </button>
  );
}

function ExampleRow({ entry, erps, onOpen, row }) {
  return (
    <div className="mg-row">
      <div className="mg-line">
        <span className="ex-lead">
          <MapIcon entryId={entry.id} />
          <ExampleCell cell={row.commerce} onOpen={onOpen} />
        </span>
        <MapArrow dir={entry.dir} moves={entry.moves} />
        {erps.map((erp) => (
          <ExampleCell cell={row.erps[erp.id]} key={erp.id} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object[]} props.history the Activity records the page read, newest first
 * @param {object[]} props.scopes the settings' scope tree, for the websites
 */
export function DataMapTab({ api, erpInfo, history, onOpen, scopes }) {
  // The grid has room for two ERPs.
  const erps = useMemo(() => erpInfo.erps.slice(0, 2), [erpInfo.erps]);
  const { placeholder, rows } = useLiveMap({ api, erps, history, scopes });
  return (
    <>
      <p className="dm-caption">
        What each system calls the same thing, with its newest real record.
        Click one to open it.
      </p>
      <section className="map-grid is-examples">
        <MapGridHead colors={erpInfo.colors} erps={erps} />
        {MAP_ENTRIES.map((entry) => (
          <ExampleRow
            entry={entry}
            erps={erps}
            key={entry.id}
            onOpen={onOpen}
            row={rows?.[entry.id] ?? placeholder}
          />
        ))}
      </section>
    </>
  );
}
