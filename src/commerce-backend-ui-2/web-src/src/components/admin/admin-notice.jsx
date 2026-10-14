/*
 * A message in the Admin's look (backend components/_messages.less, read 2026-10-14): a pale
 * yellow box, or pink for an error, #333 text, its icon at the left in the message's color.
 * For what a screen must say before its content (a problem reading it, an empty state), not for
 * a row's reason, which sits in the row.
 */
import AlertTriangle from "@react-spectrum/s2/icons/AlertTriangle";
import CheckmarkCircle from "@react-spectrum/s2/icons/CheckmarkCircle";
import CloseCircle from "@react-spectrum/s2/icons/CloseCircle";
import InfoCircle from "@react-spectrum/s2/icons/InfoCircle";

const ICONS = {
  error: CloseCircle,
  notice: InfoCircle,
  success: CheckmarkCircle,
  warning: AlertTriangle,
};

/**
 * @param {object} props
 * @param {"notice"|"warning"|"success"|"error"} [props.tone]
 */
export function AdminNotice({ children, tone = "notice" }) {
  const Icon = ICONS[tone] ?? InfoCircle;
  return (
    <div
      className={`adm-notice adm-notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}>
      <span aria-hidden="true" className="adm-notice-icon">
        <Icon />
      </span>
      <div>{children}</div>
    </div>
  );
}
