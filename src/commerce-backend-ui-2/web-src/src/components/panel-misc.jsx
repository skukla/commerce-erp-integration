/*
 * The side panel's smaller views: the companies a name search found, one Activity record as it
 * was kept, a demo reset's line, and the scheduled price publish.
 */
import { ErpChip } from "#web/components/controls.jsx";
import { SidePanel } from "#web/components/side-panel.jsx";
import { publishLine, scheduledRunRows } from "#web/scheduled-view.js";
import { clockTime, dayAndTime } from "#web/time-view.js";

const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** The companies whose name holds what was typed, to pick one. */
export function CompaniesPanel({ matches, onClose, onOpen, text }) {
  return (
    <SidePanel
      kicker="Companies"
      onClose={onClose}
      sub={`${matches.length} companies in Commerce have “${text}” in their name`}
      title={`Companies named “${text}”`}>
      <ul className="matches">
        {matches.map((company) => (
          <li key={company.id}>
            <button
              onClick={() => onOpen({ id: company.id, kind: "company" })}
              type="button">
              {company.name}
              <small>Commerce company {company.id}</small>
            </button>
          </li>
        ))}
      </ul>
    </SidePanel>
  );
}

/** What happens next to a record that did not get through. */
export function problemNote(row) {
  if (!row?.problem) {
    return null;
  }
  if (row.entry.outcome === "refused" || row.entry.outcome === "dropped") {
    return "Refused updates are not sent again by themselves. Fix the cause, then Retry.";
  }
  return row.retry
    ? "It is sent again by itself for up to a day; Retry sends it now."
    : "It is sent again by itself for up to a day.";
}

/** Who a record came from or went to, for the panel's second line. */
function RecordSub({ erpInfo, now, row }) {
  const erps = row.erpIds
    .map((id) => erpInfo.erps.find((erp) => erp.id === id))
    .filter(Boolean);
  const when = dayAndTime(row.at, now);
  return (
    <>
      {row.direction === "from" ? "From " : "To "}
      {erps.length > 0
        ? erps.map((erp) => (
            <ErpChip colors={erpInfo.colors} erp={erp} full key={erp.id} />
          ))
        : "the ERP"}{" "}
      {when}
    </>
  );
}

/** One Activity record, as it was kept. */
export function RecordPanel({ erpInfo, extra, foot, now, onClose, row }) {
  const entry = row.entry;
  const facts = [
    ["Kind", row.typeLabel],
    ["About", entry.ref || "–"],
    ["Result", row.detail ? `${row.result}: ${row.detail}` : row.result],
    ["Tries", String(entry.attempts ?? 1)],
    ["First", dayAndTime(entry.firstAt ?? entry.lastAt, now)],
    ["Last", dayAndTime(entry.lastAt, now)],
  ];
  return (
    <SidePanel
      foot={foot}
      kicker={`${row.direction === "from" ? "ERP update" : "Sent to the ERP"} · ${row.result.toLowerCase()}`}
      onClose={onClose}
      sub={<RecordSub erpInfo={erpInfo} now={now} row={row} />}
      title={row.sentence}>
      <table className="compare">
        <tbody>
          {facts.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {extra}
    </SidePanel>
  );
}

/** A demo reset's one line. */
export function ResetPanel({ erpInfo, now, onClose, row }) {
  return (
    <SidePanel
      kicker="Demo reset"
      onClose={onClose}
      sub={`${capitalized(dayAndTime(row.at, now))} · ${erpInfo.several ? "every ERP" : erpInfo.erps[0].name}`}
      title="Reset from Demo Builder">
      <p className="headline">{row.sentence}</p>
      <p className="note">
        A reset clears Activity and the scheduled-run records and leaves this
        one line. Nothing can be retried from it.
      </p>
    </SidePanel>
  );
}

/** The scheduled price publish: what it does, when it last ran and changed, and when next. */
export function ScheduledPanel({ now, onClose, runs }) {
  const when = (iso) => capitalized(dayAndTime(iso, now));
  const [row] = scheduledRunRows(runs, when);
  const line = publishLine(runs, now, (iso) => clockTime(iso));
  return (
    <SidePanel
      kicker="Scheduled run"
      onClose={onClose}
      sub="Every hour at five past"
      title="Price publish">
      <table className="compare">
        <tbody>
          <tr>
            <th>What it does</th>
            <td>
              Copies each ERP’s customer prices in force into Commerce’s shared
              catalogs
            </td>
          </tr>
          <tr>
            <th>Last run</th>
            <td>{row.lastRun}</td>
          </tr>
          <tr>
            <th>Last change</th>
            <td>{row.lastChange}</td>
          </tr>
          <tr>
            <th>Next run</th>
            <td>{line.next}</td>
          </tr>
        </tbody>
      </table>
      <p className="note">
        It runs as an App Builder alarm, not Commerce cron.
      </p>
    </SidePanel>
  );
}
