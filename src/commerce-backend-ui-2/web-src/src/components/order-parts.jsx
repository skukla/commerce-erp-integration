/*
 * One order's parts as the order view's "ERP parts" button shows them (erp/order-parts): each
 * ERP's part with its lines, status and ERP number, why a part waits, any setup warning, and
 * Re-send on a held or failed part (erp/resend-part; with one ERP and no parts kept, the Admin
 * screen's Retry of the whole order). Everything arrives as props, so the local preview
 * renders it against stand-in data too.
 */
import { useCallback, useState } from "react";

import { Alert } from "#web/components/controls.jsx";

/** A part's status in the words of the table. */
const STATUS_WORDS = Object.freeze({
  cancelled: "Canceled in the ERP",
  dropped: "Not sent",
  failed: "Failed",
  held: "Held",
  invoiced: "Invoiced",
  sending: "Sending",
  sent: "Sent",
  shipped: "Shipped",
  skipped: "Not sent (turned off)",
});

function ResendButton({ onResend, resending, row }) {
  const onPress = useCallback(() => onResend(row), [onResend, row]);
  return (
    <button
      className="btn btn-secondary btn-small"
      disabled={resending !== null}
      onClick={onPress}
      type="button">
      {resending === row.erpId ? "Re-sending" : "Re-send"}
    </button>
  );
}

function PartRow({ onResend, resending, row }) {
  return (
    <tr>
      <td>{row.erpName}</td>
      <td>{row.wholeOrder ? "The whole order" : row.skus.join(", ")}</td>
      <td>{STATUS_WORDS[row.status] ?? row.status}</td>
      <td>{row.erpNumber ?? ""}</td>
      <td>
        {row.waitsFor ?? ""}
        {row.warnings.map((warning) => (
          <div className="part-warning" key={warning}>
            Setup: {warning}
          </div>
        ))}
      </td>
      <td>
        {row.canResend && (
          <ResendButton onResend={onResend} resending={resending} row={row} />
        )}
      </td>
    </tr>
  );
}

function Unplaced({ conflicts, unrouted }) {
  if (unrouted.length === 0 && conflicts.length === 0) {
    return null;
  }
  return (
    <Alert title="Lines no part holds" tone="warn">
      {unrouted.length > 0 && (
        <p>
          {unrouted.join(", ")}: no ERP owns these products, so they were not
          sent. Set their owning ERP and place them again.
        </p>
      )}
      {conflicts.map((c) => (
        <p key={c.sku}>
          {c.sku} is claimed by {c.erps.join(" and ")}, so neither was sent it.
          Fix the setup.
        </p>
      ))}
    </Alert>
  );
}

export function OrderParts({ api, onError, onReload, page }) {
  const [resending, setResending] = useState(null);
  const [answer, setAnswer] = useState(null);
  const resend = useCallback(
    async (row) => {
      setResending(row.erpId);
      setAnswer(null);
      try {
        const result = row.wholeOrder
          ? await api.retry({ incrementId: page.incrementId })
          : await api.resendPart(page.incrementId, row.erpId);
        setAnswer(result.message ?? null);
        await onReload();
      } catch (e) {
        onError(`Re-send to ${row.erpName} failed: ${e.message}`);
      }
      setResending(null);
    },
    [api, onError, onReload, page.incrementId],
  );
  return (
    <section className="erp-order-parts">
      <p className="headline">
        Order {page.incrementId}
        {page.summary ? `: ${page.summary}.` : "."}
      </p>
      {answer && <Alert tone="ok">{answer}</Alert>}
      <Unplaced conflicts={page.conflicts} unrouted={page.unrouted} />
      {page.rows.length === 0 ? (
        <p>No ERP has a part of this order.</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>ERP</th>
              <th>Lines</th>
              <th>Status</th>
              <th>ERP number</th>
              <th>Why it waits</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <PartRow
                key={row.erpId}
                onResend={resend}
                resending={resending}
                row={row}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
