/*
 * The Data Map's own content: one entry per pair of business objects, each with an example of a
 * real record on every side and how it moves. Fixed, illustrative content (this demo's own
 * records), not a live read — the Data Map shows correspondence, it does not report status
 * (owner, 2026-09-27).
 *
 * "primary"/"secondary" are positions (the first and second ERP a project has), not names: this
 * demo always runs with exactly two ERPs, so the entries are written for that shape.
 */

export const MAP_ARROW_PATHS = Object.freeze({
  both: "M6 10h148M16 3 6 10l10 7M144 3l10 7-10 7",
  "left-only": "M6 10h148M16 3 6 10l10 7",
  none: "M6 10h148",
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
 * Commerce: "both", "to-erp", "to-commerce" or "none". Each `example` slot is a cell:
 * `[value, note, open]`, where `open` is what a click opens — `{ kind: "product"|"trace", ... }`,
 * a company by name (`{ kind: "company", name }`, resolved when clicked), or `null` for none.
 */
export const MAP_ENTRIES = Object.freeze([
  {
    dir: "both",
    example: {
      commerce: [
        "Kukla Studios",
        "credit limit 70,000, the total",
        { kind: "company", name: "Kukla Studios" },
      ],
      primary: [
        "Customer 100042",
        "credit limit 50,000",
        { kind: "company", name: "Kukla Studios" },
      ],
      secondary: [
        "Customer C-2231",
        "credit limit 20,000",
        { kind: "company", name: "Kukla Studios" },
      ],
    },
    id: "company",
    moves: "details, credit limit",
  },
  {
    dir: "both",
    example: {
      commerce: [
        "accesspoint",
        "price 199.00",
        { kind: "product", sku: "accesspoint" },
      ],
      primary: [
        "Item accesspoint",
        "list price 199.00",
        { kind: "product", sku: "accesspoint" },
      ],
      secondary: [null, "a Northwind product", null],
    },
    id: "product",
    moves: "name, price",
  },
  {
    dir: "to-commerce",
    example: {
      commerce: [
        "Kukla Studios",
        "10% off accesspoint",
        { kind: "company", name: "Kukla Studios" },
      ],
      primary: [
        "Price line for 100042",
        "10% off accesspoint",
        { kind: "company", name: "Kukla Studios" },
      ],
      secondary: [null, "no price for Kukla Studios", null],
    },
    id: "prices",
    moves: "each company’s prices",
  },
  {
    dir: "both",
    example: {
      commerce: [
        "accesspoint",
        "989 in northwind_warehouse",
        { kind: "product", sku: "accesspoint" },
      ],
      primary: [
        "989 on hand",
        "2 committed · 987 available",
        { kind: "product", sku: "accesspoint" },
      ],
      secondary: [null, "not its warehouse", null],
    },
    id: "stock",
    moves: "quantity per warehouse",
  },
  {
    dir: "both",
    example: {
      commerce: [
        "Order 3000000023",
        "1,859.00 · Pending",
        { kind: "trace", ref: "3000000023" },
      ],
      primary: [
        "Sales order 0000001013",
        "its part · confirmed",
        { kind: "trace", ref: "3000000023" },
      ],
      secondary: [
        "Sales order 0000001002",
        "its part · invoiced",
        { kind: "trace", ref: "3000000023" },
      ],
    },
    id: "order",
    moves: "order out, status back",
  },
  {
    dir: "both",
    example: {
      commerce: [
        "Order 3000000023",
        "Contoso’s line shipped and invoiced",
        { kind: "trace", ref: "3000000023" },
      ],
      primary: [
        "Not shipped yet",
        "confirmed only",
        { kind: "trace", ref: "3000000023" },
      ],
      secondary: [
        "Shipped 1:12 PM",
        "invoiced 1:20 PM",
        { kind: "trace", ref: "3000000023" },
      ],
    },
    id: "fulfil",
    moves: "shipped, invoiced",
  },
  {
    dir: "to-erp",
    example: {
      commerce: ["Bodea Website", "and Bodea B2B", null],
      primary: ["Sales org 1000", "1100 for Bodea B2B", null],
      secondary: ["Sales org 2000", "Contoso US Sales", null],
    },
    id: "website",
    moves: "code on every order",
  },
  {
    dir: "none",
    example: {
      commerce: [
        "Kukla Studios",
        "balance 1,859 owed",
        { kind: "company", name: "Kukla Studios" },
      ],
      primary: [null, "not connected yet", null],
      secondary: [null, "not connected yet", null],
    },
    gap: true,
    id: "payment",
    moves: "not connected yet",
  },
]);

/** Which way the arrow points, drawn from Commerce on the left: to the ERP, to Commerce,
 *  both, or neither. */
export function arrowPathKey(dir) {
  if (dir === "none") {
    return "none";
  }
  if (dir === "both") {
    return "both";
  }
  return dir === "to-erp" ? "right-only" : "left-only";
}
