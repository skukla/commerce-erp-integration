/*
 * The Data Map's pairs of business objects: which way each moves and its icon. Until
 * 2026-10-13 each pair carried a fixed example record, which went stale as soon as a demo's
 * data changed; the records are now read live (data-map-live.js). Payment was marked "not
 * connected yet" long after the ERP's payments reached Commerce (AB-26s).
 */

export const MAP_ARROW_PATHS = Object.freeze({
  both: "M6 10h148M16 3 6 10l10 7M144 3l10 7-10 7",
  "left-only": "M6 10h148M16 3 6 10l10 7",
  "right-only": "M6 10h148M144 3l10 7-10 7",
});

export const MAP_ICON_PATHS = Object.freeze({
  company:
    "M4 21V5l8-3v5l8 3v11zm3-3h2v-2H7zm0-4h2v-2H7zm0-4h2V8H7zm8 8h2v-2h-2zm0-4h2v-2h-2z",
  fulfil:
    "M3 6h11v9H3zm11 3h4l3 3v3h-7zM6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  order: "M6 2h12v20l-3-2-3 2-3-2-3 2zm3 5v2h6V7zm0 4v2h6v-2z",
  payment: "M2 5h20v14H2zm2 3v2h16V8zm0 6v2h5v-2z",
  prices: "M3 12V3h9l9 9-9 9zm4.5-4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  product:
    "m12 2 9 5v10l-9 5-9-5V7zm0 2.3L6 7.6l6 3.3 6-3.3zM5 9.3v6.5l6 3.3v-6.5z",
  stock: "M3 14h8v7H3zm10 0h8v7h-8zM8 4h8v7H8z",
  website:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.4a16 16 0 0 0 0 4zm5.4 0a14 14 0 0 1 0-4h4.6a14 14 0 0 1 0 4zm6.6 0a16 16 0 0 0 0-4h3.4a8 8 0 0 1 0 4zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4z",
});

/**
 * One entry per pair, in the order a business user thinks about them. `dir` is seen from
 * Commerce: "both", "to-erp" or "to-commerce". The records in each row are read live
 * (data-map-live.js).
 */
export const MAP_ENTRIES = Object.freeze([
  { dir: "both", id: "company", moves: "details, credit limit" },
  { dir: "both", id: "product", moves: "name, price" },
  { dir: "to-commerce", id: "prices", moves: "each company’s prices" },
  { dir: "both", id: "stock", moves: "quantity per warehouse" },
  { dir: "both", id: "order", moves: "order out, status back" },
  { dir: "both", id: "fulfil", moves: "shipped, invoiced" },
  { dir: "to-erp", id: "website", moves: "code on every order" },
  { dir: "to-commerce", id: "payment", moves: "payment of an invoice" },
]);

/** Which way the arrow points, drawn from Commerce on the left: to the ERP, to Commerce,
 *  or both. */
export function arrowPathKey(dir) {
  if (dir === "both") {
    return "both";
  }
  return dir === "to-erp" ? "right-only" : "left-only";
}
