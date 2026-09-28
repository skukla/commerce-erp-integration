/*
 * The integration's scheduled runs on the Activity section: what runs on a schedule, when it
 * last ran and what it last changed (erp/history?scheduled=true). Scheduled work runs as App
 * Builder alarms, not Commerce cron, so this is where the schedule can be seen working.
 */
import { Heading, Text } from "@react-spectrum/s2";
import { useEffect, useState } from "react";

import { scheduledRunRows } from "#web/scheduled-view.js";

const when = (iso) => new Date(iso).toLocaleString();

export function ScheduledRuns({ api, onError }) {
  const [runs, setRuns] = useState([]);

  useEffect(() => {
    if (!api) {
      return;
    }
    api
      .scheduled()
      .then((answer) => setRuns(answer.scheduled ?? []))
      .catch((e) => onError(`Scheduled runs failed: ${e.message}`));
  }, [api, onError]);

  return (
    <section>
      <Heading level={3}>Scheduled runs</Heading>
      <table className="erp-history-table">
        <thead>
          <tr>
            <th>What</th>
            <th>When</th>
            <th>Last ran</th>
            <th>Last change</th>
          </tr>
        </thead>
        <tbody>
          {scheduledRunRows(runs, when).map((row) => (
            <tr key={row.id}>
              <td>{row.title}</td>
              <td>{row.schedule}</td>
              <td>{row.lastRun}</td>
              <td>{row.lastChange}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Text>Scheduled work runs as App Builder alarms, not Commerce cron.</Text>
    </section>
  );
}
