/*
 * A product or a company side by side in the side panel (erp/lookup): Commerce beside the ERP
 * that owns a product, or beside each ERP a company is a customer of, row by row. A side that
 * does not have the record shows dashes; that is the answer, not an error.
 */
import { useEffect, useState } from "react";

import { ErpChip, Spinner } from "#web/components/controls.jsx";
import { SidePanel } from "#web/components/side-panel.jsx";
import { lookupTable } from "#web/lookup-view.js";

/** A cell of the answer: the value, or a dash that says the side does not have it. */
function Cell({ value }) {
  return value === null || value === undefined || value === "" ? (
    <td className="empty">—</td>
  ) : (
    <td>{value}</td>
  );
}

function CompareTable({ table }) {
  return (
    <table className="compare">
      <thead>
        <tr>
          {table.columns.map((column, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional; two can read alike
            <th key={index}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) =>
          row.code ? (
            <tr className="link-row" key={row.label}>
              <th>{row.label}</th>
              {row.cells.map((cell, index) =>
                cell ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                  <td key={index}>
                    Its screen: <code>{cell}</code>
                  </td>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                  <td className="empty" key={index} />
                ),
              )}
            </tr>
          ) : (
            <tr key={row.label}>
              <th>{row.label}</th>
              {row.cells.map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                <Cell key={index} value={cell} />
              ))}
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

/** The name Commerce holds, for the panel's title. */
function nameOf(table) {
  return table.rows.find((row) => row.label === "Name")?.cells?.[0] ?? null;
}

/**
 * @param {object} props
 * @param {{ sku: string } | { company: string }} props.query what to look up
 * @param {object} [props.answer] the answer, when the search already read it
 * @param {React.ReactNode} [props.extra] notes and a foot from the record that opened it
 */
export function LookupPanel({
  answer: given,
  api,
  erpInfo,
  extra,
  foot,
  onClose,
  onError,
  query,
}) {
  const [answer, setAnswer] = useState(given ?? null);
  const product = query.sku !== undefined;
  const asked = product ? query.sku : query.company;
  useEffect(() => {
    if (given) {
      return;
    }
    api
      .lookup(product ? { sku: asked } : { company: asked })
      .then(setAnswer)
      .catch((e) => onError(`Look-up of ${asked} failed: ${e.message}`));
  }, [api, asked, given, onError, product]);

  const erps = erpInfo.several ? erpInfo.erps : null;
  const table = answer
    ? lookupTable(answer, erpInfo.erps[0]?.name ?? "the ERP", erps)
    : null;
  const owner = answer?.owner
    ? erpInfo.erps.find((erp) => erp.id === answer.owner.id)
    : null;
  const title = product ? asked : (table && nameOf(table)) || `Company ${asked}`;
  let sub = product ? null : `Commerce company ${asked}`;
  if (owner) {
    sub = (
      <>
        Owned by <ErpChip colors={erpInfo.colors} erp={owner} full />
      </>
    );
  }
  return (
    <SidePanel
      foot={foot}
      kicker={product ? "Product · side by side" : "Company · side by side"}
      onClose={onClose}
      sub={sub}
      title={title}>
      {table ? (
        <>
          <CompareTable table={table} />
          {table.note && <p className="note">{table.note}</p>}
          {extra}
        </>
      ) : (
        <div className="panel-wait">
          <Spinner label={`Looking up ${asked}`} />
        </div>
      )}
    </SidePanel>
  );
}
