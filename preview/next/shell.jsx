/*
 * The page's frame: who this integration talks to and whether it is healthy, a side list of
 * sections, and the section asked for in the address (#overview, #credit, #activity,
 * #settings), so each section can be linked to and reloads where it was.
 */
import { Heading, StatusLight, Text } from "@react-spectrum/s2";
import { useEffect, useState } from "react";

import { ActivityView } from "./activity.jsx";
import { CreditView } from "./credit.jsx";
import { ACTIVITY, ERP } from "./data.js";
import { OverviewView } from "./overview.jsx";
import { SettingsView } from "./settings.jsx";

const SECTIONS = [
  { id: "overview", label: "Overview", View: OverviewView },
  { id: "credit", label: "Credit", View: CreditView },
  { id: "activity", label: "Activity", View: ActivityView },
  { id: "settings", label: "Settings", View: SettingsView },
];

const LEADING_HASH = /^#/;

const sectionFromHash = () => {
  const asked = window.location.hash.replace(LEADING_HASH, "");
  return SECTIONS.some((s) => s.id === asked) ? asked : "overview";
};

const failedCount = ACTIVITY.filter((a) => a.result === "failed").length;

export function Shell() {
  const [section, setSection] = useState(sectionFromHash);
  useEffect(() => {
    const onHash = () => setSection(sectionFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const { View } = SECTIONS.find((s) => s.id === section);
  return (
    <div className="nx-page" style={{ "--erp-color": ERP.color }}>
      <header className="nx-header">
        <span aria-hidden="true" className="nx-mark">
          {ERP.initials}
        </span>
        <div className="nx-title">
          <Heading level={1}>{ERP.name}</Heading>
          <StatusLight variant="positive">
            {`Connected · last message ${ERP.lastMessage}`}
          </StatusLight>
        </div>
      </header>
      <div className="nx-body">
        <nav aria-label="Sections" className="nx-nav">
          {SECTIONS.map((s) => (
            <a
              aria-current={s.id === section ? "page" : undefined}
              className="nx-nav-item"
              href={`#${s.id}`}
              key={s.id}>
              <Text>{s.label}</Text>
              {s.id === "activity" && failedCount > 0 && (
                <span className="nx-count">{failedCount}</span>
              )}
            </a>
          ))}
        </nav>
        <main className="nx-main">
          <View />
        </main>
      </div>
    </div>
  );
}
