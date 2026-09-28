/*
 * The Data Map: Commerce's own word for a business object beside what each ERP calls it, with a
 * real record in every cell (the owner-approved mockup, preview/mockups/data-map.html). It shows
 * how a pair lines up; Overview and Activity already report today's status, so this view carries
 * no health or problem state of its own. Click a cell to open that record.
 */
import { useCallback } from "react";

import { ErpChip } from "#web/components/controls.jsx";
import {
  arrowPathKey,
  MAP_ARROW_PATHS,
  MAP_ENTRIES,
  MAP_ICON_PATHS,
} from "#web/data-map-view.js";

/** A company example opens by name (Commerce holds no fixed id for it); the rest open directly. */
async function openExample(api, onError, onOpen, target) {
  if (!target) {
    return;
  }
  if (target.kind !== "company") {
    onOpen(target);
    return;
  }
  try {
    const { matches = [] } = await api.lookup({ companyName: target.name });
    if (matches.length === 1) {
      onOpen({ id: matches[0].id, kind: "company" });
    } else if (matches.length > 1) {
      onOpen({ kind: "companies", matches, text: target.name });
    } else {
      onError(`${target.name} is not a company in this project.`);
    }
  } catch (e) {
    onError(`Look-up of ${target.name} failed: ${e.message}`);
  }
}

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
function MapGridHead({ erpInfo }) {
  return (
    <div className="mg-head">
      <span className="map-col map-col-c">Commerce</span>
      <span />
      {erpInfo.erps.slice(0, 2).map((erp) => (
        <span key={erp.id}>
          <ErpChip colors={erpInfo.colors} erp={erp} full />
        </span>
      ))}
    </div>
  );
}

/** One example cell: a record if there is one to open, otherwise a plain dash. */
function ExampleCell({ api, cell, onError, onOpen }) {
  const [value, note, open] = cell;
  const isEmpty = value === null || value === undefined;
  const click = useCallback(
    () => openExample(api, onError, onOpen, open),
    [api, onError, onOpen, open],
  );
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

function ExampleRow({ api, entry, onError, onOpen }) {
  return (
    <div className={entry.gap ? "mg-row is-gap" : "mg-row"}>
      <div className="mg-line">
        <span className="ex-lead">
          <MapIcon entryId={entry.id} />
          <ExampleCell
            api={api}
            cell={entry.example.commerce}
            onError={onError}
            onOpen={onOpen}
          />
        </span>
        <MapArrow dir={entry.dir} moves={entry.moves} />
        <ExampleCell
          api={api}
          cell={entry.example.primary}
          onError={onError}
          onOpen={onOpen}
        />
        <ExampleCell
          api={api}
          cell={entry.example.secondary}
          onError={onError}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}

export function DataMapTab({ api, erpInfo, onError, onOpen }) {
  return (
    <>
      <p className="dm-caption">
        What each system calls the same thing, with a real record in every cell.
        Click one to open it.
      </p>
      <section className="map-grid is-examples">
        <MapGridHead erpInfo={erpInfo} />
        {MAP_ENTRIES.map((entry) => (
          <ExampleRow
            api={api}
            entry={entry}
            key={entry.id}
            onError={onError}
            onOpen={onOpen}
          />
        ))}
      </section>
    </>
  );
}
