/*
 * The Settings tab's cards by topic: Orders, Sales organization, Products and order numbers,
 * the read-only Connection card, and with several ERPs the list of ERPs Demo Builder set up.
 */
import { ErpChip } from "#web/components/controls.jsx";
import { SettingRow } from "#web/components/setting-row.jsx";
import { connectionFacts, ownsOptions } from "#web/settings-copy.js";
import { groupNames } from "#web/settings-view.js";

/** The rows of a card, each field that is shown, in order. */
function Rows({ names, row }) {
  return names.map((name) => row(name)).filter(Boolean);
}

export function OrdersCard({ row }) {
  return (
    <section className="settings-card">
      <h2>Orders</h2>
      <Rows names={groupNames("orders")} row={row} />
    </section>
  );
}

export function SalesOrgCard({ note, row }) {
  return (
    <section className="settings-card">
      <h2>Sales organization</h2>
      {note && <p className="card-note">{note}</p>}
      <Rows names={groupNames("salesOrg")} row={row} />
    </section>
  );
}

/** Which products the ERP owns, and its order-number prefix: at Default Config only. */
export function ProductsCard({ fields, row }) {
  // The sources and the attribute show only under the mode that reads them.
  const mode = fields.get("structure_owns")?.value;
  const hidden = {
    structure_owns_attribute: mode !== "attribute",
    structure_owns_sources: mode !== "sources",
  };
  const names = groupNames("products").filter((name) => !hidden[name]);
  return (
    <section className="settings-card">
      <h2>Products and order numbers</h2>
      <Rows names={names} row={row} />
    </section>
  );
}

export function WebsiteNote() {
  return (
    <section className="settings-card website-note">
      <p className="card-note">
        Products and order numbers are set once for every website. Switch to
        Default Config to change them.
      </p>
    </section>
  );
}

/** How the ERP is reached: set by Demo Builder, never the secret. */
export function ConnectionCard({ entry }) {
  if (!entry) {
    return null;
  }
  const facts = connectionFacts(entry);
  return (
    <section className="settings-card">
      <h2>
        Connection <small>set by Demo Builder</small>
      </h2>
      <dl className="facts">
        <div>
          <dt>Name</dt>
          <dd>{facts.name}</dd>
        </div>
        <div>
          <dt>ID</dt>
          <dd>
            <code>{facts.id}</code> · on products’ <code>erp_owner</code>
          </dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{facts.kind}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>
            <span className="addr">{facts.address}</span>
          </dd>
        </div>
        <div>
          <dt>Credential</dt>
          <dd>{facts.credential}</dd>
        </div>
      </dl>
      <p className="card-note">
        A secret is never shown. Demo Builder changes these when it adds or
        removes an ERP.
      </p>
    </section>
  );
}

/** Every ERP Demo Builder set up, with several ERPs, at All ERPs on Default Config. */
export function ErpListCard({ colors, entries }) {
  return (
    <section className="settings-card erp-list-card">
      <h2>
        ERPs <small>set by Demo Builder</small>
      </h2>
      <table className="compare erp-list">
        <thead>
          <tr>
            <th>Name</th>
            <th>ID</th>
            <th>Kind</th>
            <th>Address</th>
            <th>Credential</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const facts = connectionFacts(entry);
            return (
              <tr key={entry.id}>
                <td>
                  <ErpChip colors={colors} erp={entry} full />
                </td>
                <td>
                  <code>{facts.id}</code>
                </td>
                <td>{facts.kind}</td>
                <td className="addr">{facts.address}</td>
                <td>{facts.credential}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="card-note">
        The ID never changes: it is what a product’s <code>erp_owner</code>{" "}
        attribute holds. Demo Builder adds and removes ERPs; a secret is never
        shown.
      </p>
    </section>
  );
}

/**
 * A row maker for a view: each field's row, with its own list choices and "Use Default" box.
 * `erp` names the ERP in the words; `notSet` offers "Not set" for its ownership (several ERPs).
 * @returns {(name: string) => React.ReactNode}
 */
export function rowMaker({
  erp,
  fields,
  notSet,
  onChange,
  onUseDefault,
  statuses,
  useDefaultFor,
}) {
  return (name) => {
    const field = fields.get(name);
    if (!field) {
      return null;
    }
    return (
      <SettingRow
        erp={erp}
        field={field}
        key={name}
        onChange={onChange}
        onUseDefault={onUseDefault}
        options={
          name === "structure_owns"
            ? ownsOptions(notSet ? erp : null)
            : undefined
        }
        statuses={statuses}
        useDefault={useDefaultFor(name)}
      />
    );
  };
}
