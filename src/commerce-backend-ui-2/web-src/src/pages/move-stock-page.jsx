/*
 * The page the product grid's "Move stock between <ERP> warehouses" opens (lib/move-stock.js):
 * the selected products, where from and where to, all of it or a quantity, and the move.
 * Commerce's own transfer raises no event, so this one tells the ERP as it moves (with several
 * ERPs, each product's owning ERP; the page then says which ERP was told which products).
 */
import {
  useHostConnection,
  useIms,
  useMassActionContext,
} from "@adobe/aio-commerce-lib-admin-ui/web";
import { useCallback, useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";
import { Alert, Spinner } from "#web/components/controls.jsx";
import { movedSummary, moveIntro, plural } from "#web/move-stock-view.js";

function SourcePick({ id, label, onChange, sources, value }) {
  return (
    <label htmlFor={id}>
      {label}
      <select
        className="select"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value ?? ""}>
        {sources.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The form, once the sources are read. */
function MoveForm({ busy, onMove, productCount, sources }) {
  const [from, setFrom] = useState(sources[0]?.code ?? null);
  const [to, setTo] = useState(sources[1]?.code ?? null);
  const [amount, setAmount] = useState("all");
  const [quantity, setQuantity] = useState(1);
  const ready = from && to && from !== to && (amount === "all" || quantity >= 1);
  const submit = useCallback(
    (event) => {
      event.preventDefault();
      onMove({ from, quantity: amount === "some" ? quantity : null, to });
    },
    [amount, from, onMove, quantity, to],
  );
  return (
    <form className="move-form" onSubmit={submit}>
      <SourcePick
        id="move-from"
        label="From"
        onChange={setFrom}
        sources={sources}
        value={from}
      />
      <SourcePick
        id="move-to"
        label="To"
        onChange={setTo}
        sources={sources}
        value={to}
      />
      <fieldset>
        <legend>How much</legend>
        <label className="radio">
          <input
            checked={amount === "all"}
            name="amount"
            onChange={() => setAmount("all")}
            type="radio"
          />
          All of it (the origin is taken off the product)
        </label>
        <label className="radio">
          <input
            checked={amount === "some"}
            name="amount"
            onChange={() => setAmount("some")}
            type="radio"
          />
          A quantity of each product
        </label>
      </fieldset>
      {amount === "some" && (
        <label htmlFor="move-quantity">
          Quantity of each product
          <input
            className="input"
            id="move-quantity"
            min={1}
            onChange={(event) => setQuantity(Number(event.target.value))}
            step={1}
            type="number"
            value={quantity}
          />
        </label>
      )}
      {from && from === to && <p>Choose two different warehouses.</p>}
      <button
        className="btn btn-secondary"
        disabled={!ready || busy}
        type="submit">
        {busy ? "Moving" : `Move ${plural(productCount, "product", "products")}`}
      </button>
    </form>
  );
}

export function MoveStockPage() {
  const { data: ims, error: imsError } = useIms();
  const { data: selection, error: selectionError } = useMassActionContext();
  const { actions: host } = useHostConnection();
  const api = useMemo(() => (ims ? makeApi(ims) : null), [ims]);
  const [sources, setSources] = useState(null);
  const [erpName, setErpName] = useState("");
  const [erpNames, setErpNames] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const productIds = useMemo(() => selection?.selectedIds ?? [], [selection]);
  const move = useCallback(
    async ({ from, quantity, to }) => {
      setBusy(true);
      setError(null);
      try {
        setDone(await api.moveStock({ from, productIds, quantity, to }));
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [api, productIds],
  );
  const back = useCallback(() => host?.close(), [host]);

  useEffect(() => {
    if (!api) {
      return;
    }
    api
      .moveStockSources()
      .then((answer) => {
        setErpName(answer.erpName);
        setErpNames(answer.erpNames);
        setSources(answer.sources);
      })
      .catch((e) => setError(e.message));
  }, [api]);

  const trouble = imsError?.message ?? selectionError?.message ?? error;
  if (!(sources || trouble)) {
    return (
      <div className="erp-loading">
        <Spinner label="Loading" />
      </div>
    );
  }
  return (
    <main className="erp-subpage">
      {/* Commerce's own header already carries the action's title. */}
      <p>{moveIntro(productIds.length, erpName, erpNames)}</p>
      {trouble && <Alert title="The stock was not moved">{trouble}</Alert>}
      {done !== null && (
        <div className="move-result" role="status">
          <strong>Done.</strong> {movedSummary(done, erpName)}
        </div>
      )}
      {sources && done === null && (
        <MoveForm
          busy={busy}
          onMove={move}
          productCount={productIds.length}
          sources={sources}
        />
      )}
      <div className="actions">
        <button className="btn btn-secondary" onClick={back} type="button">
          Back to products
        </button>
      </div>
    </main>
  );
}
