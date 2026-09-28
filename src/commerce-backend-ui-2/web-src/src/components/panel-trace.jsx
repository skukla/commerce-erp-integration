/*
 * One order's whole life in the side panel (erp/history?trace=<order>): the headline, each
 * side's status, and one step per line, oldest first. A step that did not get through offers
 * Retry (the whole order) or, for one part of a split order, "Re-send this part"
 * (erp/resend-part), as the order view's ERP parts page does.
 */
import { useCallback, useEffect, useState } from "react";

import { Spinner } from "#web/components/controls.jsx";
import { SidePanel } from "#web/components/side-panel.jsx";
import { dayAndTime, whenText } from "#web/time-view.js";
import { traceHeadline, traceRow, traceSummary } from "#web/trace-view.js";

const PLACED = /^Order .+ placed$/u;
const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** One step, with Retry or Re-send only on a step that did not get through. */
function Step({ busy, now, onAct, row }) {
  const action = row.resend ?? row.retry;
  const tone = { bad: "is-bad", ok: "", warn: "is-warn" }[row.tone];
  const act = useCallback(() => onAct(row), [onAct, row]);
  return (
    <li className={tone || undefined}>
      <time dateTime={row.at}>{whenText(row.at, now)}</time>
      <span className="what">
        {row.what}
        {row.detail && <span className="detail">{row.detail}</span>}
        {(row.tries || action) && (
          <span className="step-extra">
            {row.tries}
            {action && (
              <button
                className="btn btn-secondary btn-small"
                disabled={busy}
                onClick={act}
                type="button">
                {row.resend ? "Re-send this part" : "Retry"}
              </button>
            )}
          </span>
        )}
      </span>
      <span className="where">{row.where}</span>
    </li>
  );
}

/**
 * @param {object} props
 * @param {string} props.orderRef the order number
 * @param {object} [props.trace] the trace, when the search already read it
 */
export function TracePanel({
  api,
  erpInfo,
  now,
  onChanged,
  onClose,
  onError,
  orderRef,
  trace: given,
}) {
  const [trace, setTrace] = useState(given ?? null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api
        .trace(orderRef)
        .then((answer) => setTrace(answer.trace ?? null))
        .catch((e) =>
          onError(`Order ${orderRef} could not be followed: ${e.message}`),
        ),
    [api, onError, orderRef],
  );
  useEffect(() => {
    if (!given) {
      load();
    }
  }, [given, load]);

  const act = useCallback(
    async (row) => {
      setBusy(true);
      try {
        if (row.resend) {
          await api.resendPart(row.resend.incrementId, row.resend.erpId);
        } else {
          await api.retry(row.retry);
        }
        await Promise.all([load(), onChanged()]);
      } catch (e) {
        onError(`${row.resend ? "Re-send" : "Retry"} failed: ${e.message}`);
      }
      setBusy(false);
    },
    [api, load, onChanged, onError],
  );

  const erpName = erpInfo.erps[0]?.name ?? "the ERP";
  const steps = (trace?.steps ?? []).map(traceRow);
  const placed = steps.find((step) => PLACED.test(step.what));
  return (
    <SidePanel
      kicker="Order trace"
      onClose={onClose}
      sub={placed && `Placed ${dayAndTime(placed.at, now)}`}
      title={`Order ${orderRef}`}>
      {trace ? (
        <>
          <p className="headline">
            {capitalized(traceHeadline(trace.summary, erpName))}
          </p>
          {trace.summary?.incrementId && (
            <dl className="trace-summary">
              {traceSummary(trace.summary, erpName).map((side) => (
                <div key={side.label}>
                  <dt>{side.label}</dt>
                  <dd>{side.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {steps.length > 0 && (
            <ol className="steps">
              {steps.map((row) => (
                <Step
                  busy={busy}
                  key={row.key}
                  now={now}
                  onAct={act}
                  row={row}
                />
              ))}
            </ol>
          )}
        </>
      ) : (
        <div className="panel-wait">
          <Spinner label={`Following order ${orderRef}`} />
        </div>
      )}
    </SidePanel>
  );
}
