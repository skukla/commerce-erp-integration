/*
 * The connection map: one row per connection, Commerce on the left, the ERP on the right,
 * the arrow saying who leads, the health on the end. A row opens to the fields that cross.
 * Read-only: nothing here is a setting.
 */
import { Heading, StatusLight, Text } from "@react-spectrum/s2";
import { useCallback, useState } from "react";

import { CONNECTIONS, ERP } from "./data.js";

const ARROW = {
  both: {
    d: "M3 8h14M6 5 3 8l3 3M14 5l3 3-3 3",
    label: "both systems change it",
  },
  "from-erp": { d: "M17 8H3M6 5 3 8l3 3", label: `${ERP.name} leads` },
  "to-erp": { d: "M3 8h14M14 5l3 3-3 3", label: "Commerce leads" },
};

/** The direction as a small drawn arrow: the same in every font. */
function Arrow({ direction }) {
  const { d, label } = ARROW[direction];
  return (
    <svg
      aria-label={label}
      className={`nx-arrow nx-arrow-${direction}`}
      height="16"
      role="img"
      viewBox="0 0 20 16"
      width="20">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function ConnectionRow({ connection, open, onToggle }) {
  const toggle = useCallback(
    () => onToggle(connection.id),
    [onToggle, connection.id],
  );
  const { status } = connection;
  return (
    <li className="nx-conn">
      <button
        aria-expanded={open}
        className="nx-conn-row"
        onClick={toggle}
        type="button">
        <span className="nx-conn-side">{connection.commerce}</span>
        <Arrow direction={connection.direction} />
        <span className="nx-conn-side">{connection.erp}</span>
        <span className="nx-conn-join">by {connection.joinedBy}</span>
        <span className="nx-conn-status">
          <StatusLight variant={status.failed > 0 ? "negative" : "positive"}>
            {status.text}
          </StatusLight>
        </span>
        <span aria-hidden="true" className="nx-chevron">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="nx-conn-detail">
          <Text>{connection.counts}</Text>
          <ul className="nx-fields">
            {connection.fields.map(([left, direction, right]) => (
              <li key={`${left}-${right}`}>
                <span>{left || "—"}</span>
                <Arrow direction={direction} />
                <span>{right}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function OverviewView() {
  const [open, setOpenId] = useState(null);
  const setOpen = useCallback(
    (id) => setOpenId((current) => (current === id ? null : id)),
    [],
  );
  return (
    <section aria-labelledby="nx-overview" className="nx-section">
      <Heading id="nx-overview" level={2}>
        How the systems connect
      </Heading>
      <div aria-hidden="true" className="nx-conn-head">
        <span>Adobe Commerce</span>
        <span />
        <span className="nx-erp-name">{ERP.name}</span>
      </div>
      <ul className="nx-conn-list">
        {CONNECTIONS.map((c) => (
          <ConnectionRow
            connection={c}
            key={c.id}
            onToggle={setOpen}
            open={open === c.id}
          />
        ))}
      </ul>
      <p className="nx-legend">
        <Arrow direction="to-erp" /> Commerce leads{" "}
        <Arrow direction="from-erp" /> {ERP.name} leads{" "}
        <Arrow direction="both" /> either side
      </p>
    </section>
  );
}
