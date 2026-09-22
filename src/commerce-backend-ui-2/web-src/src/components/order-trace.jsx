import { Button, Heading, Text, TextField } from "@react-spectrum/s2";
import { useCallback, useState } from "react";

import { traceHeadline, traceRow } from "#web/trace-view.js";

/** One step, with the Retry only on a step that did not get through. */
function TraceStep({ onRetry, retrying, row }) {
  const onPress = useCallback(() => onRetry(row), [onRetry, row]);
  return (
    <li className={row.failed ? "erp-step erp-step-failed" : "erp-step"}>
      <span className="erp-step-when">{new Date(row.at).toLocaleString()}</span>
      <span className="erp-step-where">{row.where}</span>
      <span className="erp-step-what">{row.what}</span>
      {row.detail && <span className="erp-step-detail">{row.detail}</span>}
      {row.tries && <span className="erp-step-tries">{row.tries}</span>}
      {row.retry && (
        <Button
          isDisabled={retrying !== null}
          onPress={onPress}
          variant="primary">
          {retrying === row.key ? "Retrying" : "Retry"}
        </Button>
      )}
    </li>
  );
}

/**
 * Follow one order end to end: type its number and see everything that happened to it —
 * placed in Commerce, sent to the ERP (or held, and why), what the ERP did, and each
 * status that came back. Anything that did not get through can be retried from here, the
 * same way the history's rows can (erp/history?trace=<order>).
 */
export function OrderTrace({ api, erpName, onError }) {
  const [number, setNumber] = useState("");
  const [trace, setTrace] = useState(null);
  const [looking, setLooking] = useState(false);
  const [retrying, setRetrying] = useState(null);

  const follow = useCallback(async () => {
    const asked = number.trim();
    if (!(api && asked)) {
      return;
    }
    setLooking(true);
    try {
      setTrace((await api.trace(asked)).trace ?? null);
    } catch (e) {
      onError(`Could not follow order ${asked}: ${e.message}`);
    }
    setLooking(false);
  }, [api, number, onError]);

  const onKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter") {
        follow();
      }
    },
    [follow],
  );

  const retry = useCallback(
    async (row) => {
      setRetrying(row.key);
      try {
        await api.retry(row.retry);
        await follow();
      } catch (e) {
        onError(`Retry failed: ${e.message}`);
      }
      setRetrying(null);
    },
    [api, follow, onError],
  );

  const rows = (trace?.steps ?? []).map(traceRow);
  return (
    <section className="erp-trace">
      <Heading level={2}>Follow an order</Heading>
      <div className="erp-trace-controls">
        <TextField
          aria-label="Order number"
          onChange={setNumber}
          onKeyDown={onKeyDown}
          placeholder="Order number, e.g. 000000042"
          value={number}
        />
        <Button isDisabled={looking} onPress={follow} variant="primary">
          {looking ? "Looking" : "Follow"}
        </Button>
      </div>
      {trace && <Text>{traceHeadline(trace.summary, erpName)}</Text>}
      {rows.length > 0 && (
        <ol className="erp-trace-steps">
          {rows.map((row) => (
            <TraceStep
              key={row.key}
              onRetry={retry}
              retrying={retrying}
              row={row}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
