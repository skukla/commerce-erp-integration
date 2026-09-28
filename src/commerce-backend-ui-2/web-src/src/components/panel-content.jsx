/*
 * What the side panel shows, by what opened it (history-view.js `open`, or the search box): an
 * order's trace, a product or company side by side, the companies a name search found, one
 * record, a demo reset, or the scheduled price publish. A record that did not get through
 * carries Retry in the panel's foot, and a note on what happens next.
 */
import { useCallback, useState } from "react";

import { LookupPanel } from "#web/components/panel-lookup.jsx";
import { MapEntryPanel } from "#web/components/panel-map.jsx";
import {
  CompaniesPanel,
  problemNote,
  RecordPanel,
  ResetPanel,
  ScheduledPanel,
} from "#web/components/panel-misc.jsx";
import { TracePanel } from "#web/components/panel-trace.jsx";

/** Retry of the record that opened the panel, and what it answered. */
function useRetry(api, row, onChanged, onError) {
  const [state, setState] = useState({ busy: false, said: null });
  const retry = useCallback(async () => {
    setState({ busy: true, said: null });
    try {
      const answer = await api.retry(row.retry);
      await onChanged();
      setState({ busy: false, said: answer?.message ?? "Sent again." });
    } catch (e) {
      onError(`Retry failed: ${e.message}`);
      setState({ busy: false, said: null });
    }
  }, [api, onChanged, onError, row]);
  return { ...state, retry };
}

/**
 * @param {object} props
 * @param {object} props.panel what to show: `{ kind, ref | sku | id | matches, row?, ... }`
 */
export function PanelContent({
  api,
  erpInfo,
  now,
  onChanged,
  onClose,
  onError,
  onOpen,
  panel,
  runs,
}) {
  const { row } = panel;
  const { busy, retry, said } = useRetry(api, row, onChanged, onError);
  const foot = row?.retriable ? (
    <button
      className="btn btn-secondary"
      disabled={busy}
      onClick={retry}
      type="button">
      {busy ? "Retrying" : "Retry"}
    </button>
  ) : null;
  const note = problemNote(row);
  const extra = (
    <>
      {note && <p className="note">{note}</p>}
      {said && (
        <p className="note" role="status">
          {said}
        </p>
      )}
    </>
  );
  const common = { api, erpInfo, now, onClose, onError };
  switch (panel.kind) {
    case "trace":
      return (
        <TracePanel
          {...common}
          key={panel.ref}
          onChanged={onChanged}
          orderRef={panel.ref}
          trace={panel.trace}
        />
      );
    case "product":
    case "company":
      return (
        <LookupPanel
          {...common}
          answer={panel.answer}
          extra={extra}
          foot={foot}
          key={`${panel.kind}.${panel.sku ?? panel.id}`}
          query={
            panel.kind === "product"
              ? { sku: panel.sku }
              : { company: panel.id }
          }
        />
      );
    case "companies":
      return (
        <CompaniesPanel
          matches={panel.matches}
          onClose={onClose}
          onOpen={onOpen}
          text={panel.text}
        />
      );
    case "map":
      return (
        <MapEntryPanel
          entryId={panel.entryId}
          erpInfo={erpInfo}
          key={panel.entryId}
          onClose={onClose}
        />
      );
    case "reset":
      return <ResetPanel {...common} row={row} />;
    case "scheduled":
      return <ScheduledPanel {...common} runs={runs} />;
    default:
      return <RecordPanel {...common} extra={extra} foot={foot} row={row} />;
  }
}
