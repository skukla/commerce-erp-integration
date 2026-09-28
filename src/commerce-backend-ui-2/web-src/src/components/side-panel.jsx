/*
 * The Admin's slide-in side panel: a kicker, a title, a line under it, the body, and a foot of
 * buttons. A dialog: focus moves to Close when it opens, Tab stays inside it, Escape or a click
 * on the page behind closes it, and focus goes back to what opened it.
 */
import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab inside the panel. */
function trapTab(event, panel) {
  if (event.key !== "Tab" || !panel) {
    return;
  }
  const items = [...panel.querySelectorAll(FOCUSABLE)];
  if (items.length === 0) {
    return;
  }
  const [first] = items;
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * @param {object} props
 * @param {string} props.kicker the line above the title ("Order trace")
 * @param {string} props.title
 * @param {React.ReactNode} [props.sub] the line under the title
 * @param {React.ReactNode} [props.foot] the buttons at the bottom
 * @param {() => void} props.onClose
 */
export function SidePanel({ children, foot, kicker, onClose, sub, title }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  // Held in a ref: the panel is set up once when it opens, whatever the parent re-renders.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        close.current();
        return;
      }
      trapTab(event, panelRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a mouse shortcut; Escape and the Close button are the keyboard's way out */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: as above, Escape closes the panel */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: as above; a real button here would sit on top of the page as a full-screen click target, which is not what a scrim is */}
      <div className="scrim" onClick={onClose} />
      <aside
        aria-labelledby="panel-title"
        aria-modal="true"
        className="panel"
        ref={panelRef}
        role="dialog">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">{kicker}</p>
            <h2 id="panel-title">{title}</h2>
            {sub && <p className="panel-sub">{sub}</p>}
          </div>
          <button
            aria-label="Close"
            className="panel-close"
            onClick={onClose}
            ref={closeRef}
            type="button">
            ×
          </button>
        </div>
        <div className="panel-body">{children}</div>
        {foot && <div className="panel-foot">{foot}</div>}
      </aside>
    </>
  );
}
