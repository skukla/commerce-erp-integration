import { Button, Checkbox, Heading, Text } from "@react-spectrum/s2";
import { useCallback, useEffect, useState } from "react";

import { historyRow } from "#web/history-view.js";

/** Retry for one order: disabled while any retry runs, and says which one is running. */
function RetryButton({ onRetry, order, retrying }) {
  const onPress = useCallback(() => onRetry(order), [onRetry, order]);
  return (
    <Button isDisabled={retrying !== null} onPress={onPress} variant="primary">
      {retrying === order ? "Retrying" : "Retry"}
    </Button>
  );
}

/**
 * What crossed to the ERP and how it ended, one row per order, with a Retry on an order
 * that did not get through (erp/history).
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
    async (order) => {
      setRetrying(order);
      try {
        await api.retryOrder(order);
        await load();
      } catch (e) {
        onError(`Retry of order ${order} failed: ${e.message}`);
      }
      setRetrying(null);
    },
    [api, load, onError],
  );

  const rows = entries.map(historyRow);
  return (
    <section className="erp-history">
      <Heading level={2}>Orders sent to {erpName}</Heading>
      <div className="erp-history-controls">
        <Checkbox isSelected={failedOnly} onChange={setFailedOnly}>
          Only orders that did not get through
        </Checkbox>
        <Button onPress={load} variant="secondary">
          Refresh
        </Button>
      </div>
      {rows.length === 0 ? (
        <Text>No orders yet.</Text>
      ) : (
        <table className="erp-history-table">
          <thead>
            <tr>
              <th>Last update</th>
              <th>Order</th>
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
                <td>{row.order}</td>
                <td>{row.result}</td>
                <td>{row.tries}</td>
                <td>{row.message}</td>
                <td>
                  {row.retriable && (
                    <RetryButton
                      onRetry={retry}
                      order={row.order}
                      retrying={retrying}
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
