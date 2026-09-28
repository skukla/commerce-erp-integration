/*
 * What each setting connects, and which system decides: Commerce on the left, the ERP on the
 * right, one row per thing the two share. The connector's arrow points from the system that
 * decides; the chips under it are the real settings that shape the row, each opening Settings
 * at that field. A row opens to the fields matched one to one. With several ERPs the section
 * shows one at a time.
 */
import {
  Badge,
  Heading,
  Picker,
  PickerItem,
  StatusLight,
  Text,
} from "@react-spectrum/s2";
import { useCallback, useState } from "react";

import {
  ERPS,
  MAPPING_ROWS,
  MAPPING_SETTINGS,
  MAPPING_VALUES,
} from "./data.js";

const SCOPE_WORDS = { global: "Integration-wide", website: "Website" };
const FIGURE_LIGHT = { negative: "negative", notice: "notice" };

const deciderWords = (decides, erp) => {
  if (decides === "commerce") {
    return "Commerce decides";
  }
  if (decides === "erp") {
    return `${erp.short} decides`;
  }
  return "Each decides its part";
};

/** A drawn line with its head(s) toward the system that follows. */
function Connector({ decides, erp }) {
  return (
    <span className={`nx-map-link nx-map-link-${decides}`}>
      <span aria-hidden="true" className="nx-map-line">
        {decides !== "commerce" && <span className="nx-map-head nx-map-head-left" />}
        <span className="nx-map-rule" />
        {decides !== "erp" && <span className="nx-map-head nx-map-head-right" />}
      </span>
      <span className="nx-map-decider">{deciderWords(decides, erp)}</span>
    </span>
  );
}

/** One real setting: label, where it is set, its value; opens Settings at that field. */
function SettingChip({ name, erpId }) {
  const setting = MAPPING_SETTINGS[name];
  return (
    <a
      className="nx-chip"
      href={`#settings/${name}`}
      title={`Open "${setting.label}" in Settings`}>
      <span className="nx-chip-label">{setting.label}</span>
      <span className={`nx-chip-scope nx-chip-scope-${setting.scope}`}>
        {SCOPE_WORDS[setting.scope]}
      </span>
      <span className="nx-chip-value">{MAPPING_VALUES[erpId][name]}</span>
      <span className="nx-visually-hidden">, open in Settings</span>
    </a>
  );
}

function RowFooter({ row, erp }) {
  const figure = row.figure[erp.id];
  return (
    <div className="nx-map-foot">
      <div className="nx-map-chips">
        {row.settings.length > 0 ? (
          row.settings.map((name) => (
            <SettingChip erpId={erp.id} key={name} name={name} />
          ))
        ) : (
          <span className="nx-map-nosetting">{row.noSetting}</span>
        )}
      </div>
      <span className="nx-map-figure">
        <StatusLight variant={FIGURE_LIGHT[figure.tone] ?? "positive"}>
          {figure.text}
        </StatusLight>
      </span>
    </div>
  );
}

const OWNER_WORDS = (owner, erp) =>
  ({ both: "Both", commerce: "Commerce", erp: erp.short })[owner];

/** The fields matched one to one, each with the system that decides it. */
function RowDetail({ row, erp, id }) {
  return (
    <div className="nx-map-detail" id={id}>
      <table className="nx-map-fields">
        <caption className="nx-visually-hidden">
          {row.commerce} and {row.erp}, field by field
        </caption>
        <thead>
          <tr>
            <th scope="col">In Commerce</th>
            <th scope="col">Decided by</th>
            <th scope="col">In {erp.name}</th>
          </tr>
        </thead>
        <tbody>
          {row.fields.map(([left, owner, right]) => (
            <tr key={`${left}|${right}`}>
              <td>{left || <span className="nx-map-none">Not kept</span>}</td>
              <td>
                <span className={`nx-owner nx-owner-${owner}`}>
                  {OWNER_WORDS(owner, erp)}
                </span>
              </td>
              <td>{right || <span className="nx-map-none">Not kept</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {row.fieldsNote && (
        <ul className="nx-map-notes">
          {row.fieldsNote.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Side({ isNew, name, note, sub }) {
  return (
    <span className="nx-map-side">
      <span className="nx-map-name">
        {name}
        {note && <span className="nx-map-name-note"> {note}</span>}
        {isNew && (
          <Badge UNSAFE_className="nx-map-new" size="S" variant="informative">
            New
          </Badge>
        )}
      </span>
      <span className="nx-map-sub">{sub}</span>
    </span>
  );
}

function MappingRow({ row, erp, open, onToggle }) {
  const toggle = useCallback(() => onToggle(row.id), [onToggle, row.id]);
  const detailId = `nx-map-detail-${row.id}`;
  return (
    <li className={`nx-map-row${open ? " is-open" : ""}`}>
      <h3 className="nx-map-h">
        <button
          aria-controls={detailId}
          aria-expanded={open}
          className="nx-map-top"
          onClick={toggle}
          type="button">
          <Side
            isNew={row.isNew}
            name={row.commerce}
            note={row.commerceNote}
            sub={row.where}
          />
          <span className="nx-map-middle">
            <Connector decides={row.decides} erp={erp} />
            <span className="nx-map-sentence">{row.sentence}</span>
          </span>
          <Side name={row.erp} note={row.erpNote} sub={row.part[erp.id]} />
          <span aria-hidden="true" className="nx-map-chevron" />
        </button>
      </h3>
      <RowFooter erp={erp} row={row} />
      {open && <RowDetail erp={erp} id={detailId} row={row} />}
    </li>
  );
}

export function MappingView() {
  const [erpId, setErpId] = useState(ERPS[0].id);
  const [open, setOpenId] = useState(null);
  const erp = ERPS.find((e) => e.id === erpId);
  const setOpen = useCallback(
    (id) => setOpenId((current) => (current === id ? null : id)),
    [],
  );
  const pick = useCallback((key) => setErpId(String(key)), []);
  return (
    <section
      aria-labelledby="nx-mapping"
      className="nx-section nx-map"
      style={{ "--map-erp": erp.color }}>
      <div className="nx-section-head">
        <div>
          <Heading id="nx-mapping" level={2}>
            Mapping
          </Heading>
          <Text UNSAFE_className="nx-map-lede">
            What each setting connects, and which system decides.
          </Text>
        </div>
        <Picker
          items={ERPS}
          label="ERP"
          labelPosition="side"
          onSelectionChange={pick}
          selectedKey={erpId}>
          {(e) => <PickerItem id={e.id}>{e.name}</PickerItem>}
        </Picker>
      </div>
      <div aria-hidden="true" className="nx-map-cols">
        <span>Adobe Commerce</span>
        <span />
        <span className="nx-map-col-erp">{erp.name}</span>
      </div>
      <ul className="nx-map-list">
        {MAPPING_ROWS.map((row) => (
          <MappingRow
            erp={erp}
            key={row.id}
            onToggle={setOpen}
            open={open === row.id}
            row={row}
          />
        ))}
      </ul>
    </section>
  );
}
