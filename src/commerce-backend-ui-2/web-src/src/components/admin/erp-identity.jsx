/*
 * An ERP's identity where ERPs sit side by side (the band): its own mark on its own color, its
 * name, and whether it answers on a second line (owner, 2026-10-14: between a flat label and
 * the old tinted pills). The marks are demo-erp's own four (screen/src/components/Logo.js in
 * skukla/demo-erp), drawn in one color so they sit on any palette; the ERP names its mark and
 * palette in its health `appearance`. An ERP that names none shows its initial.
 */
import { AdminStatus } from "#web/components/admin/admin-status.jsx";
import { erpStyle } from "#web/components/controls.jsx";

function Monogram({ name }) {
  const letter = (String(name ?? "").trim()[0] ?? "E").toUpperCase();
  return (
    <text
      dominantBaseline="central"
      fill="currentColor"
      fontSize="13"
      fontWeight="700"
      stroke="none"
      textAnchor="middle"
      x="12"
      y="12.5">
      {letter}
    </text>
  );
}

const Cube = () => (
  <>
    <path d="M12 2 L22 7 L22 17 L12 22 L2 17 L2 7 Z" />
    <path d="M12 12 L2 7 M12 12 L22 7 M12 12 L12 22" />
  </>
);

const Orbit = () => (
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="3" fill="currentColor" r="2.4" />
  </>
);

const Layers = () => (
  <>
    <path d="M12 2.5 L21 6 L12 9.5 L3 6 Z" />
    <path d="M12 8.5 L21 12 L12 15.5 L3 12 Z" />
    <path d="M12 14.5 L21 18 L12 21.5 L3 18 Z" />
  </>
);

const MARKS = { cube: Cube, layers: Layers, monogram: Monogram, orbit: Orbit };

/** The ERP's mark, white on its color. */
function ErpMark({ erp }) {
  const Mark = MARKS[erp.appearance?.logo] ?? Monogram;
  return (
    <span aria-hidden="true" className="erp-badge">
      <svg
        aria-hidden="true"
        fill="none"
        height="18"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
        viewBox="0 0 24 24"
        width="18">
        <Mark name={erp.name} />
      </svg>
    </span>
  );
}

/**
 * @param {object} props
 * @param {object} props.colors each ERP's color (overview-view.js erpColors)
 * @param {{ id: string, name: string, appearance?: { logo?: string } }} props.erp
 * @param {{ reachable: boolean, text: string }} props.line whether it answers, and how it reads
 */
export function ErpIdentity({ colors, erp, line }) {
  return (
    <span className="erp-identity" style={erpStyle(colors, erp.id)}>
      <ErpMark erp={erp} />
      <span>
        <strong>{erp.name}</strong>
        <AdminStatus tone={line.reachable ? "ok" : "warn"}>
          {line.text}
        </AdminStatus>
      </span>
    </span>
  );
}
