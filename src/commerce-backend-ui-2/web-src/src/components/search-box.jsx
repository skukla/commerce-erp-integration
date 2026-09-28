/*
 * The Overview's one search box: an order number opens the order's trace, a Commerce company id
 * the company, and anything else a product by SKU, then a company by a part of its name
 * (erp/lookup ?companyName). What matches nothing says so under the box.
 */
import { useCallback, useState } from "react";

import { lookupFound } from "#web/lookup-view.js";
import { searchExamples, searchTarget } from "#web/search-view.js";

/** Where the search looked, in the words of its miss. */
function whereLooked(erpInfo) {
  if (!erpInfo.several) {
    return "the ERP";
  }
  return erpInfo.erps.length === 2 ? "either ERP" : "any ERP";
}

/** A SKU, or nothing when what was typed cannot be one (erp/lookup refuses it). */
async function productAnswer(api, text) {
  try {
    const answer = await api.lookup({ sku: text });
    return lookupFound(answer) ? answer : null;
  } catch {
    return null;
  }
}

/** Open what was typed, or answer false when nothing matches it. */
async function find(api, target, onOpen) {
  if (target.kind === "order") {
    const { trace } = await api.trace(target.ref);
    if (!trace?.summary?.incrementId && (trace?.steps ?? []).length === 0) {
      return false;
    }
    onOpen({ kind: "trace", ref: target.ref, trace });
    return true;
  }
  if (target.kind === "company") {
    const answer = await api.lookup({ company: target.id });
    if (!lookupFound(answer)) {
      return false;
    }
    onOpen({ answer, id: target.id, kind: "company" });
    return true;
  }
  const product = await productAnswer(api, target.text);
  if (product) {
    onOpen({ answer: product, kind: "product", sku: target.text });
    return true;
  }
  const { matches = [] } = await api.lookup({ companyName: target.text });
  if (matches.length === 1) {
    onOpen({ id: matches[0].id, kind: "company" });
  } else if (matches.length > 1) {
    onOpen({ kind: "companies", matches, text: target.text });
  }
  return matches.length > 0;
}

export function SearchBox({ api, erpInfo, history, onOpen }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [miss, setMiss] = useState(null);

  const search = useCallback(
    async (typed) => {
      const target = searchTarget(typed);
      if (!target) {
        return;
      }
      setBusy(true);
      setMiss(null);
      try {
        if (!(await find(api, target, onOpen))) {
          setMiss(
            `Nothing in Commerce or ${whereLooked(erpInfo)} matches “${typed.trim()}”.`,
          );
        }
      } catch (e) {
        setMiss(`The search failed: ${e.message}`);
      }
      setBusy(false);
    },
    [api, erpInfo, onOpen],
  );
  const submit = useCallback(
    (event) => {
      event.preventDefault();
      search(text);
    },
    [search, text],
  );
  const examples = searchExamples(history);
  return (
    <form className="search" onSubmit={submit} role="search">
      <label htmlFor="erp-search">Find an order, product or company</label>
      <div className="search-row">
        <input
          aria-describedby="erp-search-hint"
          autoComplete="off"
          className="input"
          id="erp-search"
          onChange={(event) => setText(event.target.value)}
          placeholder="Order number, SKU, or a company’s name or id"
          type="search"
          value={text}
        />
        <button className="btn btn-secondary" disabled={busy} type="submit">
          {busy ? "Finding" : "Find"}
        </button>
      </div>
      <div className="search-hint" id="erp-search-hint">
        {examples.length > 0 ? (
          <>
            Try{" "}
            {examples.map((example, index) => (
              <span key={example.text}>
                {index > 0 && (index === examples.length - 1 ? " or " : ", ")}
                <button
                  className="btn btn-link"
                  onClick={() => {
                    setText(example.text);
                    search(example.text);
                  }}
                  type="button">
                  {example.label}
                </button>
              </span>
            ))}
          </>
        ) : (
          "An order number, a SKU, or a company’s name or Commerce id."
        )}
      </div>
      {miss && (
        <div className="search-miss" role="status">
          {miss}
        </div>
      )}
    </form>
  );
}
