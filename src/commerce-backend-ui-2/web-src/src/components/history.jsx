import { Button, Checkbox, Heading, Text } from "@react-spectrum/s2";
import { useCallback, useEffect, useState } from "react";

import { historyRow } from "#web/history-view.js";

/** Retry for one row: disabled while any retry runs, and says which one is running. */
function RetryButton({ onRetry, row, retrying }) {
  const onPress = useCallback(() => onRetry(row), [onRetry, row]);
  return (
    <Button isDisabled={retrying !== null} onPress={onPress} variant="primary">
      {retrying === row.key ? "Retrying" : "Retry"}
    </Button>
  );
}

/**
 * What crossed between Commerce and the ERP and how it ended — orders sent to the ERP, and
 * ERP events applied to Commerce — with a Retry on anything that did not get through
 * (erp/history).
 */
export function History({ api, erpName, onError }) {
  const [entries, setEntries] = useState([]);
  const [failedOnly, setFailedOnly] = useState(false);
  const [retrying, setRetrying] = useState(null);

  const load = useCallback(async () => {
    if (!api) {
      return;
    }
    try {
      setEntries((await api.history(failedOnly)).entries ?? []);
    } catch (e) {
      onError(`History failed: ${e.message}`);
    }
  }, [api, failedOnly, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = useCallback(
    async (row) => {
      setRetrying(row.key);
      try {
        await api.retry(row.retry);
        await load();
      } catch (e) {
        onError(`Retry of ${row.what} failed: ${e.message}`);
      }
      setRetrying(null);
    },
    [api, load, onError],
  );

  const rows = entries.map((entry) => historyRow(entry, erpName));
  return (
    <section className="erp-history">
      <Heading level={2}>What crossed between Commerce and {erpName}</Heading>
      <div className="erp-history-controls">
        <Checkbox isSelected={failedOnly} onChange={setFailedOnly}>
          Only what did not get through
        </Checkbox>
        <Button onPress={load} variant="secondary">
          Refresh
        </Button>
      </div>
      {rows.length === 0 ? (
        <Text>Nothing has crossed yet.</Text>
      ) : (
        <table className="erp-history-table">
          <thead>
            <tr>
              <th>Last update</th>
              <th>Direction</th>
              <th>What</th>
              <th>Result</th>
              <th>Tries</th>
              <th>Details</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{new Date(row.when).toLocaleString()}</td>
                <td>{row.direction}</td>
                <td>{row.what}</td>
                <td>{row.result}</td>
                <td>{row.tries}</td>
                <td>{row.message}</td>
                <td>
                  {row.retriable && (
                    <RetryButton
                      onRetry={retry}
                      retrying={retrying}
                      row={row}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
