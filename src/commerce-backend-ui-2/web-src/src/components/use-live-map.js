/*
 * The Data Map's live reads (data-map-live.js): the key map, then one look-up per record the
 * rows show, all at once. Read again whenever the page reads Activity again (Refresh). A read
 * that fails empties only its own rows.
 */
import { useEffect, useState } from "react";

import {
  companyRow,
  emptyRow,
  fulfilRow,
  mapPicks,
  NOT_READ,
  orderRow,
  paymentRow,
  pricesRow,
  productRow,
  stockRow,
  websiteRow,
  websitesOf,
} from "#web/data-map-live.js";

const READING = "Reading";

/** A read's rows, or its rows emptied with "Could not be read". */
async function rowsOf(ids, erps, read) {
  try {
    return await read();
  } catch {
    return Object.fromEntries(ids.map((id) => [id, emptyRow(erps, NOT_READ)]));
  }
}

async function companyRows(api, erps, picks, keyMap) {
  if (!picks.companyId) {
    return { company: emptyRow(erps) };
  }
  const lookup = await api.lookup({ company: picks.companyId });
  return { company: companyRow(lookup, erps, keyMap) };
}

async function productRows(api, erps, picks) {
  if (!picks.sku) {
    return { product: emptyRow(erps), stock: emptyRow(erps) };
  }
  const lookup = await api.lookup({ sku: picks.sku });
  return { product: productRow(lookup, erps), stock: stockRow(lookup, erps) };
}

async function orderRows(api, erps, picks, history) {
  if (!picks.order) {
    return { fulfil: emptyRow(erps), order: emptyRow(erps) };
  }
  const { trace } = await api.trace(picks.order);
  return {
    fulfil: fulfilRow(picks.order, history, erps),
    order: orderRow(picks.order, trace, erps),
  };
}

async function websiteRows(api, erps, scopes) {
  const websites = websitesOf(scopes);
  if (websites.length === 0) {
    return { website: emptyRow(erps) };
  }
  const codes = websites.map((w) => w.code);
  const answers = await Promise.all(
    erps.map((erp) => api.settingsForErp(codes, erp.id)),
  );
  const perErp = Object.fromEntries(erps.map((erp, i) => [erp.id, answers[i]]));
  return { website: websiteRow(websites, perErp, erps) };
}

async function readRows(api, erps, history, scopes) {
  const keyMap = (await api.keyMap().catch(() => ({}))).entries ?? [];
  const picks = mapPicks(history, keyMap);
  const parts = await Promise.all([
    rowsOf(["company"], erps, () => companyRows(api, erps, picks, keyMap)),
    rowsOf(["product", "stock"], erps, () => productRows(api, erps, picks)),
    rowsOf(["order", "fulfil"], erps, () =>
      orderRows(api, erps, picks, history),
    ),
    rowsOf(["website"], erps, () => websiteRows(api, erps, scopes)),
  ]);
  return Object.assign(
    {
      payment: picks.payment ? paymentRow(picks.payment, erps) : emptyRow(erps),
      prices: picks.contract ? pricesRow(picks.contract, erps) : emptyRow(erps),
    },
    ...parts,
  );
}

/**
 * @param {{ api: object, erps: object[], history: object[], scopes: object[] }} args
 * @returns {{ rows: Record<string, object>|null, placeholder: object }} the rows by pair id
 *   once read, and the row to show until then
 */
export function useLiveMap({ api, erps, history, scopes }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let current = true;
    readRows(api, erps, history, scopes).then((read) => {
      if (current) {
        setRows(read);
      }
    });
    return () => {
      current = false;
    };
  }, [api, erps, history, scopes]);
  return { placeholder: emptyRow(erps, READING), rows };
}
