/*
 * The frame every tab sits in: Commerce Admin's gray band with each ERP's identity (its mark,
 * its name, whether it answers) and the tab's own actions on the right (Save Config), then the
 * tabs Overview, Activity, Settings, Data Map. The Admin draws the left rail and the page title
 * "ERP Integration" around the frame, so neither is drawn here.
 *
 * Refresh is not here: each tab has its own beside what it updates (admin-refresh.jsx).
 */
import { useCallback } from "react";

import { ErpIdentity } from "#web/components/admin/erp-identity.jsx";
import { erpStatusLine } from "#web/overview-view.js";

export const TABS = Object.freeze([
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
  { id: "data-map", label: "Data Map" },
]);

/** One ERP in the band: its mark, its name, and whether it answers. */
function ErpStatus({ colors, erp }) {
  return <ErpIdentity colors={colors} erp={erp} line={erpStatusLine(erp)} />;
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
 * @param {React.ReactNode} props.actions the tab's own actions (Settings' Save Config)
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
        {actions && <div className="band-actions">{actions}</div>}
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
