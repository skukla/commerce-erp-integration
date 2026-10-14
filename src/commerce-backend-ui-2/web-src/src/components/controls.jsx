/*
 * The page's own small parts, in Commerce Admin's look (index.css): an ERP's chip in its color,
 * a spinner, a message, and the question before unsaved changes are dropped.
 */
import { useEffect, useRef } from "react";

import { shortName } from "#web/history-view.js";

/** The custom properties that color one ERP's elements (index.css --erp, --erp-tint). */
export function erpStyle(colors, id) {
  const color = colors[id];
  return color ? { "--erp": color.color, "--erp-tint": color.tint } : undefined;
}

/**
 * One ERP by name, after a small square of its color: how an ERP is named where several sit
 * side by side (the band, the Data Map's head). Its color is never a fill or an edge
 * (owner, 2026-10-14).
 */
export function ErpName({ colors, erp, full = true }) {
  return (
    <span className="erp-name" style={erpStyle(colors, erp.id)}>
      <span aria-hidden="true" className="erp-mark" />
      {full ? erp.name : shortName(erp.name)}
    </span>
  );
}

/** One ERP, in its color: its short name, or its full name with `full`. */
export function ErpChip({ colors, erp, full = false }) {
  return (
    <span className="chip chip-erp" style={erpStyle(colors, erp.id)}>
      {full ? erp.name : shortName(erp.name)}
    </span>
  );
}

export function Spinner({ label }) {
  return <div aria-label={label} className="spinner" role="progressbar" />;
}

/** A message across the page: something went wrong, it worked, or a notice. */
export function Alert({ children, onDismiss, title, tone = "bad" }) {
  return (
    <div
      className={`alert alert-${tone}`}
      role={tone === "bad" ? "alert" : "status"}>
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
      {onDismiss && (
        <button
          aria-label="Dismiss"
          className="btn btn-link"
          onClick={onDismiss}
          type="button">
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Commerce's own question before a switch that drops unsaved changes ("All data that hasn't
 * been saved will be lost"). A plain dialog: the Admin frame may block the browser's confirm().
 */
export function ConfirmDialog({ message, onCancel, onConfirm, title }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <>
      <div className="scrim" />
      <div
        aria-labelledby="confirm-title"
        aria-modal="true"
        className="confirm"
        role="alertdialog">
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="confirm-actions">
          <button
            className="btn btn-secondary"
            onClick={onCancel}
            ref={cancelRef}
            type="button">
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm} type="button">
            OK
          </button>
        </div>
      </div>
    </>
  );
}
