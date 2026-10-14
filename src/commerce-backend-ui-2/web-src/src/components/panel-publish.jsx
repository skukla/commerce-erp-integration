/*
 * A price publish in the side panel (owner, 2026-10-14): the spot-check of what a scheduled
 * publish did, opened from its row under Activity. Its counts, each price row it moved before
 * and after, and the customers it skipped or could not publish, with why.
 */
import { AdminFacts } from "#web/components/admin/admin-facts.jsx";
import { SidePanel } from "#web/components/side-panel.jsx";
import {
  publishChanges,
  publishFacts,
  publishProblems,
  STARTED_BY,
} from "#web/publish-view.js";
import { dayAndTime } from "#web/time-view.js";

const CHANGE_SIDES = ["Before", "After"];

/** The rows moved, or what a publish that moved none says. */
function Changes({ entry }) {
  const rows = publishChanges(entry);
  if (rows.length === 0) {
    return <p className="note">It moved no price.</p>;
  }
  return (
    <>
      <AdminFacts label="Prices moved" rows={rows} sides={CHANGE_SIDES} />
      {entry.moreChanges > 0 && (
        <p className="note">
          And {entry.moreChanges} more, not kept. A record keeps the first 200.
        </p>
      )}
    </>
  );
}

export function PublishPanel({ erpInfo, now, onClose, row }) {
  const { entry } = row;
  const erpName = (id) =>
    erpInfo.erps.find((erp) => erp.id === id)?.name ?? `ERP ${id}`;
  const problems = publishProblems(entry, erpName);
  const started = STARTED_BY[entry.by] ?? "Price publish";
  return (
    <SidePanel
      kicker="Price publish"
      onClose={onClose}
      sub={`${started}, ${dayAndTime(row.at, now)}`}
      title={row.details}>
      <AdminFacts label="What it did" rows={publishFacts(entry)} />
      <h3 className="panel-subhead">Prices moved</h3>
      <Changes entry={entry} />
      {problems.length > 0 && (
        <>
          <h3 className="panel-subhead">Not published</h3>
          <ul className="panel-list">
            {problems.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </SidePanel>
  );
}
