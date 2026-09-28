/*
 * The Data Map's own content: one entry per pair of business objects (Commerce's own word, each
 * ERP's word, an example of a real record, and how it moves), and the longer copy the "Data Map"
 * side panel shows for it. Fixed, illustrative content (this demo's own records), not a live
 * read — the Data Map explains correspondence, it does not report status (owner, 2026-09-27).
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
 * One entry per pair, in the order a business user thinks about them.
 * `dir` is seen from Commerce: "both", "to-erp", "to-commerce" or "none".
 * `example.<slot>[2]` is what a click opens: `{ kind: "product"|"trace", ... }`, a company by
 * name (`{ kind: "company", name }`, resolved when clicked), or `null` when nothing opens.
 */
export const MAP_ENTRIES = Object.freeze([
  {
    commerce: "Company",
    dir: "both",
    example: {
      commerce: ["Kukla Studios", "credit limit 70,000, the total"],
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
    primary: ["Customer", "5 business partners"],
    secondary: ["Customer", "5 business partners"],
  },
  {
    commerce: "Product",
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
    primary: ["Item", "the 3 products it owns"],
    secondary: ["Item", "the 3 products it owns"],
  },
  {
    commerce: "Shared Catalog",
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
    primary: ["Price lists", "for its own products"],
    secondary: ["Price lists", "for its own products"],
  },
  {
    commerce: "Stock",
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
    primary: ["Inventory", "Northwind warehouse"],
    secondary: ["Inventory", "Contoso warehouse"],
  },
  {
    commerce: "Order",
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
    primary: ["Sales order", "its lines of each order"],
    secondary: ["Sales order", "its lines of each order"],
  },
  {
    commerce: "Shipment & invoice",
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
    primary: ["Delivery & billing", "for its own lines"],
    secondary: ["Delivery & billing", "for its own lines"],
  },
  {
    commerce: "Website",
    dir: "to-erp",
    example: {
      commerce: ["Bodea Website", "and Bodea B2B", null],
      primary: ["Sales org 1000", "1100 for Bodea B2B", null],
      secondary: ["Sales org 2000", "Contoso US Sales", null],
    },
    id: "website",
    moves: "code on every order",
    primary: ["Sales organization", "1000, and 1100 for B2B"],
    secondary: ["Sales organization", "2000 on both websites"],
  },
  {
    commerce: "Payment",
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
    primary: ["Payment", "not connected yet"],
    secondary: ["Payment", "not connected yet"],
  },
]);

/** The Data Map side panel's longer copy, by entry id. */
export const MAP_PANELS = Object.freeze({
  company: {
    body: "Joined by the company’s customer number in each ERP. Commerce sends the company; each ERP sends back its credit limit, and a block holds that ERP’s orders.",
    facts: {
      primary: "Kukla Studios is customer 100042",
      secondary: "Kukla Studios is customer C-2231",
    },
    title: "Company ↔ Customer",
  },
  fulfil: {
    body: "Joined through the order. Shipped or invoiced in either system, recorded in the other. Each ERP ships and invoices only its own lines.",
    title: "Shipment & invoice ↔ Delivery & billing",
  },
  order: {
    body: "Joined by the ERP’s order number, shown on the order as NORT-0000001013. An order with products from both ERPs is split: each ERP gets its own lines, and each sends back its number and status. Holds and cancels go both ways.",
    title: "Order ↔ Sales order",
  },
  payment: {
    body: "Nothing crosses yet. A payment recorded in the ERP does not change what a company owes in Commerce.",
    title: "Payment · not connected yet",
  },
  prices: {
    body: "Joined by the company’s customer number. Each ERP’s price lists and discounts, never below its discount limit, become prices in the company’s own shared catalog, for the products that ERP owns. They are published again every hour.",
    facts: {
      primary: "Kukla Studios gets 10% off accesspoint",
      secondary: "No customer prices yet",
    },
    title: "Shared Catalog ← Price lists",
  },
  product: {
    body: "Joined by the SKU, which is the ERP’s item number. A product made in Commerce is added to the ERP that owns it; a name or price changed on either side is copied to the other.",
    facts: {
      primary: "Products in its warehouse, like accesspoint",
      secondary: "Products whose erp_owner is contoso, like proliantdl380",
    },
    title: "Product ↔ Item",
  },
  stock: {
    body: "Joined by the inventory source, which is the ERP’s warehouse. A quantity changed on either side is copied to the other.",
    facts: {
      primary: "Northwind warehouse",
      secondary: "Contoso warehouse",
    },
    title: "Stock ↔ Inventory",
  },
  website: {
    body: "Joined by the sales organization each website sells through. Every order and company sent to the ERP carries it.",
    facts: {
      primary: "1000 on Bodea Website, 1100 on Bodea B2B",
      secondary: "2000 on both websites",
    },
    title: "Website → Sales organization",
  },
});

/** The five things kept in step all the time, feeding every order (the Process view's tiles). */
export const MAP_MASTER_DATA = Object.freeze([
  { entryId: "company", label: "Company & credit", note: "both ways" },
  { entryId: "product", label: "Product & price", note: "both ways" },
  { entryId: "prices", label: "Shared Catalog", note: "from the ERP" },
  { entryId: "stock", label: "Stock", note: "both ways" },
  { entryId: "website", label: "Sales organization", note: "to the ERP" },
]);

/** The order-to-cash steps the Process view draws, each opening a Data Map entry. */
export const MAP_PROCESS_STEPS = Object.freeze([
  {
    eg: "Order 3000000023 · 1,859.00",
    entryId: "order",
    label: "Order placed",
    n: 1,
    who: "Commerce",
  },
  {
    back: "number and status back to Commerce",
    entryId: "order",
    label: "Sales order",
    lanes: [
      ["primary", "0000001013 · confirmed"],
      ["secondary", "0000001002 · invoiced"],
    ],
    linkTo: "its lines, split by product",
    n: 2,
  },
  {
    back: "recorded in Commerce",
    entryId: "fulfil",
    label: "Shipment",
    lanes: [
      ["primary", "not yet"],
      ["secondary", "shipped 1:12 PM"],
    ],
    linkTo: "each ERP ships its own lines",
    n: 3,
  },
  {
    back: "recorded in Commerce",
    entryId: "fulfil",
    label: "Invoice",
    lanes: [
      ["primary", "not yet"],
      ["secondary", "invoiced 1:20 PM"],
    ],
    linkTo: "each ERP bills its own lines",
    n: 4,
  },
  {
    eg: "Kukla Studios owes 1,859.00",
    entryId: "payment",
    gap: true,
    label: "Payment",
    linkTo: "not connected yet",
    n: 5,
    who: "Not connected yet",
  },
]);

/** Toward Commerce, toward the ERP, both, or neither, seen from `commerceSide`. */
export function arrowPathKey(dir, commerceSide = "left") {
  if (dir === "none") {
    return "none";
  }
  if (dir === "both") {
    return "both";
  }
  const towardRight = (dir === "to-erp") === (commerceSide === "left");
  return towardRight ? "right-only" : "left-only";
}

/** The Hub view's two sides: this demo always has exactly two ERPs. */
export function splitErpsForHub(erps) {
  return { left: erps[0] ?? null, right: erps[1] ?? null };
}
