/*
 * The Data Map: Commerce's own word for a business object beside what each ERP calls it, in four
 * ways to look at the same correspondence (the owner-approved mockup, preview/mockups/data-map.html).
 * It explains how a pair is joined; Overview and Activity already report today's status, so this
 * view carries no health or problem state of its own.
 */
import { Fragment, useCallback, useState } from "react";

import { ErpChip, erpStyle } from "#web/components/controls.jsx";
import { MapEntryDetails } from "#web/components/panel-map.jsx";
import {
  arrowPathKey,
  MAP_ARROW_PATHS,
  MAP_ENTRIES,
  MAP_ICON_PATHS,
  MAP_MASTER_DATA,
  MAP_PROCESS_STEPS,
  splitErpsForHub,
} from "#web/data-map-view.js";

const VIEWS = [
  {
    caption:
      "What each system calls the same thing. Click a row for how they are joined.",
    id: "side",
    label: "Side by side",
  },
  {
    caption:
      "The same map, with a real record in every cell. Click one to open it.",
    id: "examples",
    label: "Examples",
  },
  {
    caption: "An order’s journey from Commerce through the ERPs. Click a step.",
    id: "process",
    label: "Process",
  },
  {
    caption: "Commerce in the middle, each ERP beside it. Click a line.",
    id: "hub",
    label: "Hub",
  },
];

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

function MapArrow({ commerceSide = "left", dir, moves }) {
  const path = arrowPathKey(dir, commerceSide);
  return (
    <span className="map-arrow">
      <svg
        aria-hidden="true"
        className="dm-svg"
        data-dir={dir}
        viewBox="0 0 160 20">
        <path d={MAP_ARROW_PATHS[path]} />
      </svg>
      <span>{moves}</span>
    </span>
  );
}

function ViewButton({ item, onChange, view }) {
  const select = useCallback(() => onChange(item.id), [item.id, onChange]);
  return (
    <button aria-pressed={item.id === view} onClick={select} type="button">
      {item.label}
    </button>
  );
}

function ViewSwitch({ onChange, view }) {
  return (
    <div className="dm-views">
      <fieldset aria-label="How to show the map" className="segmented">
        {VIEWS.map((item) => (
          <ViewButton
            item={item}
            key={item.id}
            onChange={onChange}
            view={view}
          />
        ))}
      </fieldset>
      <p className="dm-caption">
        {VIEWS.find((item) => item.id === view).caption}
      </p>
    </div>
  );
}

/** One row of the Side by side view: click it to expand the Data Map copy inline. */
function SideRow({ entry, erpInfo, onToggle, open }) {
  const toggle = useCallback(() => onToggle(entry.id), [entry.id, onToggle]);
  const rowClass = ["mg-row", entry.gap && "is-gap", open && "is-open"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={rowClass}>
      <button
        aria-expanded={open}
        className="mg-line"
        onClick={toggle}
        type="button">
        <span className="map-ent">
          <MapIcon entryId={entry.id} />
          {entry.commerce}
        </span>
        <MapArrow dir={entry.dir} moves={entry.moves} />
        <span className="erp-cell">
          <strong>{entry.primary[0]}</strong>
          <small>{entry.primary[1]}</small>
        </span>
        <span className="erp-cell">
          <strong>{entry.secondary[0]}</strong>
          <small>{entry.secondary[1]}</small>
        </span>
      </button>
      {open && (
        <div className="map-more">
          <MapEntryDetails entryId={entry.id} erpInfo={erpInfo} />
        </div>
      )}
    </div>
  );
}

function SideView({ erpInfo }) {
  const [openId, setOpenId] = useState(null);
  const toggle = useCallback(
    (id) => setOpenId((current) => (current === id ? null : id)),
    [],
  );
  return (
    <section className="map-grid">
      <MapGridHead erpInfo={erpInfo} />
      {MAP_ENTRIES.map((entry) => (
        <SideRow
          entry={entry}
          erpInfo={erpInfo}
          key={entry.id}
          onToggle={toggle}
          open={openId === entry.id}
        />
      ))}
    </section>
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

function ExamplesView({ api, erpInfo, onError, onOpen }) {
  return (
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
  );
}

function MasterTile({ onOpen, tile }) {
  const open = useCallback(
    () => onOpen({ entryId: tile.entryId, kind: "map" }),
    [onOpen, tile.entryId],
  );
  return (
    <button className="proc-tile" onClick={open} type="button">
      <strong>{tile.label}</strong>
      <span>{tile.note}</span>
    </button>
  );
}

function ProcessStep({ onOpen, step }) {
  const open = useCallback(
    () => onOpen({ entryId: step.entryId, kind: "map" }),
    [onOpen, step.entryId],
  );
  return (
    <button
      className={step.gap ? "proc-step is-gap" : "proc-step"}
      onClick={open}
      type="button">
      <span className="proc-n">{step.n}</span>
      <strong>{step.label}</strong>
      {step.who && (
        <span className={step.gap ? "proc-who" : "proc-who c"}>{step.who}</span>
      )}
      {step.eg && <span className="proc-eg">{step.eg}</span>}
      {step.lanes?.map(([slot, text]) => (
        <span className="proc-lane" key={slot}>
          {text}
        </span>
      ))}
      {step.back && <span className="proc-back">{step.back}</span>}
    </button>
  );
}

function ProcessLink({ step }) {
  return (
    <span className={step.gap ? "proc-link is-gap" : "proc-link"}>
      <svg aria-hidden="true" viewBox="0 0 60 20">
        <path d={step.gap ? "M4 10h50" : "M4 10h50M46 3l8 7-8 7"} />
      </svg>
      <span>{step.linkTo}</span>
    </span>
  );
}

function ProcessView({ onOpen }) {
  return (
    <section className="proc">
      <div className="proc-master">
        <h2>Kept in step all the time</h2>
        <div className="proc-tiles">
          {MAP_MASTER_DATA.map((tile) => (
            <MasterTile key={tile.entryId} onOpen={onOpen} tile={tile} />
          ))}
        </div>
        <p className="proc-feeds">↓ used by every order</p>
      </div>
      <div className="proc-flow">
        {MAP_PROCESS_STEPS.map((step, index) => (
          <Fragment key={step.n}>
            {index > 0 && <ProcessLink step={step} />}
            <ProcessStep onOpen={onOpen} step={step} />
          </Fragment>
        ))}
      </div>
      <p className="proc-note">
        Holds and cancels go both ways at any step. Shown: order 3000000023,
        which has products from both ERPs.
      </p>
    </section>
  );
}

function HubLine({ commerceSide, entry, onOpen }) {
  const open = useCallback(
    () => onOpen({ entryId: entry.id, kind: "map" }),
    [entry.id, onOpen],
  );
  return (
    <button className="hub-line" onClick={open} type="button">
      <MapArrow commerceSide={commerceSide} dir={entry.dir} moves="" />
    </button>
  );
}

function HubRow({ entry, erpInfo, left, onOpen, right }) {
  return (
    <div className={entry.gap ? "hub-row is-gap" : "hub-row"}>
      <span
        className="hub-cell"
        style={left && erpStyle(erpInfo.colors, left.id)}>
        {entry.primary[0]}
      </span>
      <HubLine commerceSide="right" entry={entry} onOpen={onOpen} />
      <span className="hub-cell hub-c">
        <MapIcon entryId={entry.id} />
        {entry.commerce}
      </span>
      <HubLine commerceSide="left" entry={entry} onOpen={onOpen} />
      <span
        className="hub-cell"
        style={right && erpStyle(erpInfo.colors, right.id)}>
        {entry.secondary[0]}
      </span>
    </div>
  );
}

function HubView({ erpInfo, onOpen }) {
  const { left, right } = splitErpsForHub(erpInfo.erps);
  return (
    <section className="hub">
      <div className="hub-head">
        <div
          className="hub-sys"
          style={left && erpStyle(erpInfo.colors, left.id)}>
          {left && <strong>{left.name}</strong>}
        </div>
        <span />
        <div className="hub-sys hub-sys-c">
          <strong>Commerce</strong>
        </div>
        <span />
        <div
          className="hub-sys"
          style={right && erpStyle(erpInfo.colors, right.id)}>
          {right && <strong>{right.name}</strong>}
        </div>
      </div>
      {MAP_ENTRIES.map((entry) => (
        <HubRow
          entry={entry}
          erpInfo={erpInfo}
          key={entry.id}
          left={left}
          onOpen={onOpen}
          right={right}
        />
      ))}
    </section>
  );
}

export function DataMapTab({ api, erpInfo, onError, onOpen }) {
  const [view, setView] = useState("examples");
  return (
    <>
      <ViewSwitch onChange={setView} view={view} />
      {view === "side" && <SideView erpInfo={erpInfo} />}
      {view === "examples" && (
        <ExamplesView
          api={api}
          erpInfo={erpInfo}
          onError={onError}
          onOpen={onOpen}
        />
      )}
      {view === "process" && <ProcessView onOpen={onOpen} />}
      {view === "hub" && <HubView erpInfo={erpInfo} onOpen={onOpen} />}
    </>
  );
}
