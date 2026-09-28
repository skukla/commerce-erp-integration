/*
 * The Data Map's own copy: what a pair means, and each ERP's own fact about it. Shown in the
 * side panel from the Process and Hub views, and inline under a row in the Side by side view
 * (`MapEntryDetails` is shared so the two never drift apart).
 */
import { ErpChip } from "#web/components/controls.jsx";
import { SidePanel } from "#web/components/side-panel.jsx";
import { MAP_PANELS } from "#web/data-map-view.js";

/** One ERP's fact, in its color, for a Data Map entry's list. */
function MapFact({ erp, erpInfo, text }) {
  return (
    <li>
      <ErpChip colors={erpInfo.colors} erp={erp} full />
      {text}
    </li>
  );
}

/** What a pair means, and each ERP's own fact about it — the body every Data Map view shares. */
export function MapEntryDetails({ entryId, erpInfo }) {
  const panel = MAP_PANELS[entryId];
  const [left, right] = erpInfo.erps;
  return (
    <>
      <p>{panel.body}</p>
      {panel.facts && (
        <ul className="map-erps">
          {left && (
            <MapFact erp={left} erpInfo={erpInfo} text={panel.facts.primary} />
          )}
          {right && (
            <MapFact
              erp={right}
              erpInfo={erpInfo}
              text={panel.facts.secondary}
            />
          )}
        </ul>
      )}
    </>
  );
}

/**
 * @param {object} props
 * @param {string} props.entryId one of `MAP_ENTRIES`' ids
 */
export function MapEntryPanel({ entryId, erpInfo, onClose }) {
  return (
    <SidePanel
      kicker="Data Map"
      onClose={onClose}
      title={MAP_PANELS[entryId].title}>
      <MapEntryDetails entryId={entryId} erpInfo={erpInfo} />
    </SidePanel>
  );
}
