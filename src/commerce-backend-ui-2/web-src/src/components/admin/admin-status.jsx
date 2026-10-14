/*
 * How a record ended: Spectrum 2's StatusLight, a dot and a word, in Commerce Admin's message
 * colors (styles/admin-skin.css). The one way the page shows an outcome.
 */
import { StatusLight } from "@react-spectrum/s2/StatusLight";

/** The page's tones (history-view.js TONE) as StatusLight variants. */
const VARIANT = {
  bad: "negative",
  neutral: "neutral",
  ok: "positive",
  warn: "notice",
};

export function AdminStatus({ children, tone }) {
  return (
    <StatusLight
      size="S"
      UNSAFE_className={`adm-status adm-status-${tone}`}
      variant={VARIANT[tone] ?? "neutral"}>
      {children}
    </StatusLight>
  );
}
