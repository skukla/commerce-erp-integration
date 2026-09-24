import { Button, TextField } from "@react-spectrum/s2";
import { useCallback, useState } from "react";

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
 * that is the answer the card exists to give, not an error.
 */
export function Lookup({ api, erpName, lookup, onError }) {
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

  const found = (side) => (answer.found[side] ? "" : " · not found");

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
      {answer && (
        <table className="erp-lookup-table">
          <thead>
            <tr>
              <th>{answer.key}</th>
              <th>Commerce{found("commerce")}</th>
              <th>
                {erpName}
                {found("erp")}
              </th>
            </tr>
          </thead>
          <tbody>
            {answer.rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <Cell value={row.commerce} />
                <Cell value={row.erp} />
              </tr>
            ))}
            {answer.erpHash && (
              <tr>
                <td>In {erpName}</td>
                <td />
                <td>
                  <code>{answer.erpHash}</code>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
