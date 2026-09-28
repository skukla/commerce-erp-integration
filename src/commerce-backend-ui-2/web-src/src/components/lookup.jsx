import { Button, Text, TextField } from "@react-spectrum/s2";
import { useCallback, useState } from "react";

import { lookupTable } from "#web/lookup-view.js";

/** A cell of the answer: the value, or a dash that says the side does not have it. */
function Cell({ value }) {
  return value === null || value === undefined ? (
    <td className="erp-lookup-missing">—</td>
  ) : (
    <td>{value}</td>
  );
}

/**
 * "What do you hold for X?" on a card: one SKU or one Commerce company id, asked of both
 * systems, answered row by row (erp/lookup). A side that does not have it shows dashes;
 * that is the answer the card exists to give, not an error. With several ERPs a product is
 * shown beside the ERP that owns it and a company beside each ERP (lookup-view.js).
 */
export function Lookup({ api, erpName, erps, lookup, onError }) {
  const [key, setKey] = useState("");
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback(async () => {
    const value = key.trim();
    if (!value) {
      return;
    }
    setBusy(true);
    try {
      setAnswer(
        await api.lookup(
          lookup.kind === "company" ? { company: value } : { sku: value },
        ),
      );
    } catch (e) {
      onError(`Look-up failed: ${e.message}`);
    }
    setBusy(false);
  }, [api, key, lookup.kind, onError]);

  const table = answer ? lookupTable(answer, erpName, erps) : null;

  return (
    <div className="erp-lookup">
      <div className="erp-lookup-controls">
        <TextField
          label={`Look up by ${lookup.label}`}
          onChange={setKey}
          value={key}
        />
        <Button
          isDisabled={busy || !api || !key.trim()}
          onPress={ask}
          variant="secondary">
          {busy ? "Asking" : "Look up"}
        </Button>
      </div>
      {table?.note && <Text>{table.note}</Text>}
      {table && (
        <table className="erp-lookup-table">
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                {row.cells.map((cell, index) =>
                  row.code ? (
                    <td key={index}>{cell && <code>{cell}</code>}</td>
                  ) : (
                    <Cell key={index} value={cell} />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
