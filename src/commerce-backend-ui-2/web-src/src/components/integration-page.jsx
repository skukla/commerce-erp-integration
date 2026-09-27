/*
 * The integration's page, as it looks once everything it shows has loaded (MainPage waits
 * for that, so nothing half-drawn is ever on screen). Commerce's own header already names the
 * ERP, so the page opens with whether the ERP answers, then a short list of sections: what
 * the integration holds, what has crossed, and what a merchant chooses. Everything arrives as
 * props, so the page renders against stand-in data in the local preview too.
 */
import {
  Heading,
  InlineAlert,
  ProgressCircle,
  StatusLight,
  Text,
} from "@react-spectrum/s2";
import { useCallback, useState } from "react";

import { ActivitySection } from "#web/components/activity-section.jsx";
import { OverviewSection } from "#web/components/overview-section.jsx";
import { SettingsSection } from "#web/components/settings-section.jsx";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

/** What shows until everything the page needs has arrived: one spinner, nothing half-drawn. */
export function PageLoading() {
  return (
    <main className="erp-loading">
      <ProgressCircle aria-label="Loading the integration" isIndeterminate />
    </main>
  );
}

function NavItem({ current, onSelect, section }) {
  const select = useCallback(
    () => onSelect(section.id),
    [onSelect, section.id],
  );
  return (
    <button
      aria-current={current ? "page" : undefined}
      className="erp-nav-item"
      onClick={select}
      type="button">
      {section.label}
    </button>
  );
}

export function IntegrationPage({
  api,
  error,
  initialSection = "overview",
  onError,
  scopes,
  scopesNote,
  settingsPage,
  status,
}) {
  const [section, setSection] = useState(initialSection);
  const erp = status?.erp ?? {};
  const erpName = erp.displayName || "the ERP";
  return (
    <div className="erp-page">
      <div className="erp-status">
        <StatusLight variant={erp.reachable ? "positive" : "negative"}>
          {erp.reachable
            ? `Connected to ${erpName}`
            : `${erpName} does not answer`}
        </StatusLight>
        <Text>
          Orders go to {erpName}; its prices, stock, credit and order progress
          come back to Commerce as they change.
        </Text>
      </div>
      {error && (
        <InlineAlert variant="negative">
          <Heading>Something went wrong</Heading>
          <Text>{error}</Text>
        </InlineAlert>
      )}
      <div className="erp-body">
        <nav aria-label="Sections" className="erp-nav">
          {SECTIONS.map((s) => (
            <NavItem
              current={s.id === section}
              key={s.id}
              onSelect={setSection}
              section={s}
            />
          ))}
        </nav>
        <main className="erp-main">
          {section === "overview" && (
            <OverviewSection
              api={api}
              erpName={erpName}
              onError={onError}
              status={status}
            />
          )}
          {section === "activity" && (
            <ActivitySection api={api} erpName={erpName} onError={onError} />
          )}
          {section === "settings" && (
            <>
              {scopesNote && (
                <InlineAlert variant="notice">
                  <Text>{scopesNote}</Text>
                </InlineAlert>
              )}
              <SettingsSection
                api={api}
                initialPage={settingsPage}
                onError={onError}
                scopes={scopes}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
