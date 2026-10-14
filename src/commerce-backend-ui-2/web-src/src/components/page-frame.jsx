/*
 * The frame every tab sits in: Commerce Admin's gray band with one chip per ERP (its color, its
 * name, whether it answers) and the tab's own actions on the right, then the tabs Overview ·
 * Activity · Settings · Data Map. The Admin draws the left rail and the page title "ERP
 * Integration" around the frame, so neither is drawn here.
 *
 * The band always ends with when the page was read and Spectrum's refresh action, the same
 * place on every tab (owner, 2026-10-13). The page reads itself only when asked, and once when
 * it comes back on screen; it does not poll.
 */
import { ActionButton } from "@react-spectrum/s2/ActionButton";
import Refresh from "@react-spectrum/s2/icons/Refresh";
import { ProgressCircle } from "@react-spectrum/s2/ProgressCircle";
import { Tooltip, TooltipTrigger } from "@react-spectrum/s2/Tooltip";
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

/** When the page was read, and the action that reads it again. Off while it reads, or when
 *  `disabled` (Settings with unsaved changes). */
function Freshness({ busy, checked, disabled = false, onRefresh }) {
  return (
    <span className="band-fresh">
      <span className="band-note">Checked {checked}</span>
      <TooltipTrigger>
        <ActionButton
          aria-label="Refresh"
          isDisabled={busy || disabled}
          isQuiet
          onPress={onRefresh}
          size="S">
          {busy ? (
            <ProgressCircle aria-label="Refreshing" isIndeterminate size="S" />
          ) : (
            <Refresh />
          )}
        </ActionButton>
        <Tooltip>Refresh</Tooltip>
      </TooltipTrigger>
    </span>
  );
}

/**
 * @param {object} props
 * @param {{ erps: object[], colors: object }} props.erpInfo the listed ERPs and their colors
 * @param {string} props.tab the tab shown
 * @param {(id: string) => void} props.onTab switch tabs
 * @param {number} props.attention how many records need attention (the Overview's count)
 * @param {React.ReactNode} props.actions the tab's own actions, before the refresh
 * @param {{ busy: boolean, checked: string, disabled?: boolean, onRefresh: () => void }}
 *   props.refresh when the page was read, and how to read it again
 * @param {React.ReactNode} [props.notice] a message under the tabs
 */
export function PageFrame({
  actions,
  attention,
  children,
  erpInfo,
  notice,
  onTab,
  refresh,
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
        <div className="band-actions">
          {actions}
          <Freshness {...refresh} />
        </div>
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
