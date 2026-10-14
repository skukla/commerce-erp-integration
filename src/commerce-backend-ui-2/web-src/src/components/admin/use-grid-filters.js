/*
 * The state behind AdminFilterBar, for any grid: the filters in force, and the Filters panel's
 * draft, which applies only on Apply Filters, as the Admin's grid filters do. The keyword search
 * is applied as it is typed and is not part of the draft. A grid supplies its own fields and its
 * own chips' words; this holds the rules.
 */
import { useCallback, useState } from "react";

/**
 * @param {object} none every filter off, with `text` for the keyword search
 * @param {object} [start] filters in force at first (Activity opened on one ERP)
 * @returns {{ filters: object, draft: object, setDraft: Function, setText: Function,
 *   openPanel: Function, apply: Function, clearAll: Function, drop: Function }}
 *   `drop(patch)` makes a chip's remove: it sets the patch on the filters in force
 */
export function useGridFilters(none, start = none) {
  const [filters, setFilters] = useState(start);
  const [draft, setDraft] = useState(start);
  const openPanel = useCallback(() => setDraft(filters), [filters]);
  const apply = useCallback(
    () => setFilters((current) => ({ ...draft, text: current.text })),
    [draft],
  );
  const setText = useCallback(
    (text) => setFilters((current) => ({ ...current, text })),
    [],
  );
  const clearAll = useCallback(
    () => setFilters((current) => ({ ...none, text: current.text })),
    [none],
  );
  const drop = useCallback(
    (patch) => () => setFilters((current) => ({ ...current, ...patch })),
    [],
  );
  return {
    apply,
    clearAll,
    draft,
    drop,
    filters,
    openPanel,
    setDraft,
    setText,
  };
}
