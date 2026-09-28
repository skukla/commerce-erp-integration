/*
 * The frame every tab sits in: Commerce Admin's gray band with one chip per ERP (its color, its
 * name, whether it answers) and the tab's own actions on the right, then the tabs Overview ·
 * Activity · Settings · Data Map. The Admin draws the left rail and the page title "ERP
 * Integration" around the frame, so neither is drawn here.
 */
import { useCallback } from "react";

import { erpStyle } from "#web/components/controls.jsx";
import { erpStatusLine } from "#web/overview-view.js";

export const TABS = Object.freeze([
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
  { id: "data-map", label: "Data Map" },
]);

/** One ERP in the band: its color, its name, and whether it answers. */
function ErpStatus({ colors, erp }) {
  const line = erpStatusLine(erp);
  return (
    <span className="erp-status" style={erpStyle(colors, erp.id)}>
      <strong>{erp.name}</strong>
      <span className="state">
        <span className={line.reachable ? "dot" : "dot warn"} />
        {line.text}
      </span>
    </span>
  );
}

function Tab({ attention, current, onSelect, tab }) {
  const select = useCallback(() => onSelect(tab.id), [onSelect, tab.id]);
  return (
    <button
      aria-current={current ? "page" : undefined}
      onClick={select}
      type="button">
      {tab.label}
      {tab.id === "overview" && attention > 0 && (
        <span className="tab-count">
          <span className="sr-only">, needs attention: </span>
          {attention}
        </span>
      )}
    </button>
  );
}

/**
 * @param {object} props
 * @param {{ erps: object[], colors: object }} props.erpInfo the listed ERPs and their colors
 * @param {string} props.tab the tab shown
 * @param {(id: string) => void} props.onTab switch tabs
 * @param {number} props.attention how many records need attention (the Overview's count)
 * @param {React.ReactNode} props.actions the band's right side, the tab's own
 * @param {React.ReactNode} [props.notice] a message under the tabs
 */
export function PageFrame({
  actions,
  attention,
  children,
  erpInfo,
  notice,
  onTab,
  tab,
}) {
  return (
    <div className="erp-page">
      <div className="band">
        <div className="band-erps">
          {erpInfo.erps.map((erp) => (
            <ErpStatus colors={erpInfo.colors} erp={erp} key={erp.id} />
          ))}
        </div>
        <div className="band-actions">{actions}</div>
      </div>
      <nav aria-label="ERP Integration sections" className="tabs">
        {TABS.map((item) => (
          <Tab
            attention={attention}
            current={item.id === tab}
            key={item.id}
            onSelect={onTab}
            tab={item}
          />
        ))}
      </nav>
      {notice}
      <main>{children}</main>
    </div>
  );
}
