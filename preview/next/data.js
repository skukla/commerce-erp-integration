/*
 * Stand-in data for the redesigned Admin page (plan §5b of the several-ERPs plan in
 * demo-builder-vscode). Shapes follow the page's needs, not a live action yet: this is a
 * preview to react to before anything is built for real.
 */

export const ERP = {
  color: "#1f6f5c",
  initials: "NW",
  lastMessage: "2 minutes ago",
  name: "Northwind ERP",
};

/** One row per connection: who leads (`to-erp`, `from-erp`, `both`), the join, the health. */
export const CONNECTIONS = [
  {
    commerce: "Companies",
    counts: "4 companies",
    direction: "to-erp",
    erp: "Customers",
    fields: [
      ["Name, status, company admin", "to-erp", "Customer (sold-to)"],
      ["Legal name, tax id, address", "to-erp", "Legal identity"],
      ["", "from-erp", "Payment terms"],
    ],
    id: "companies",
    joinedBy: "company id",
    status: { failed: 0, text: "In sync" },
  },
  {
    commerce: "Products",
    counts: "182 products",
    direction: "to-erp",
    erp: "Products",
    fields: [
      ["SKU, name, type", "to-erp", "Product"],
      ["Price", "both", "List price"],
      ["", "from-erp", "Base unit, sales status"],
    ],
    id: "products",
    joinedBy: "SKU",
    status: { failed: 0, text: "In sync" },
  },
  {
    commerce: "Shared catalog prices",
    counts: "6 contract lines",
    direction: "from-erp",
    erp: "Contracts",
    fields: [
      ["Custom price per company", "from-erp", "Contract price, validity"],
    ],
    id: "prices",
    joinedBy: "company and SKU",
    status: { failed: 0, text: "In sync" },
  },
  {
    commerce: "Stock",
    counts: "2 warehouses",
    direction: "both",
    erp: "Warehouse stock",
    fields: [
      ["Source quantity", "both", "On hand"],
      ["", "from-erp", "Committed, available"],
    ],
    id: "stock",
    joinedBy: "SKU and source",
    status: { failed: 0, text: "In sync" },
  },
  {
    commerce: "Orders",
    counts: "12 orders",
    direction: "to-erp",
    erp: "Sales orders",
    fields: [
      ["Order, items, buyer", "to-erp", "Sales order, lines, sold-to"],
      ["Status, comments", "from-erp", "Confirmation, notes"],
      ["Hold", "both", "Credit hold"],
      ["Cancellation", "both", "Cancellation with reason"],
    ],
    id: "orders",
    joinedBy: "order number",
    status: { failed: 1, text: "1 not sent" },
  },
  {
    commerce: "Shipments and invoices",
    counts: "5 documents",
    direction: "both",
    erp: "Deliveries and invoices",
    fields: [
      ["Shipment", "both", "Delivery"],
      ["Invoice", "both", "Invoice"],
    ],
    id: "documents",
    joinedBy: "order",
    status: { failed: 0, text: "In sync" },
  },
  {
    commerce: "Company credit (total)",
    counts: "4 accounts",
    direction: "from-erp",
    erp: "Credit accounts",
    fields: [
      ["Credit limit: the total across ERPs", "from-erp", "Credit limit"],
      [
        "Custom attributes: northwind_*",
        "from-erp",
        "Limit, exposure, available, on hold",
      ],
    ],
    id: "credit",
    joinedBy: "company id",
    status: { failed: 0, text: "In sync" },
  },
];

export const CREDIT = [
  {
    account: "C18",
    available: 50_000,
    company: "Altura",
    exposure: 0,
    held: 0,
    limit: 50_000,
  },
  {
    account: "C19",
    available: 71_500,
    company: "ServerSavvy Solutions",
    exposure: 8500,
    held: 0,
    limit: 80_000,
  },
  {
    account: "C20",
    available: 0,
    company: "RackMaster",
    exposure: 25_000,
    held: 1,
    limit: 25_000,
  },
  {
    account: "C21",
    available: 118_400,
    company: "Kukla Studios",
    exposure: 1600,
    held: 0,
    limit: 120_000,
  },
];

export const ACTIVITY = [
  {
    detail: "The ERP did not answer in 30 seconds.",
    direction: "to-erp",
    id: "a1",
    result: "failed",
    what: "Order 000000014",
    when: "10:42",
  },
  {
    detail: "Sales order NORT-0000001043.",
    direction: "to-erp",
    id: "a2",
    result: "sent",
    what: "Order 000000013",
    when: "10:31",
  },
  {
    detail: "Name changed.",
    direction: "from-erp",
    id: "a3",
    result: "applied",
    what: "Product smartcable",
    when: "10:05",
  },
  {
    detail: "25,000 USD.",
    direction: "from-erp",
    id: "a4",
    result: "applied",
    what: "Credit limit, RackMaster",
    when: "09:58",
  },
  {
    detail: "Customer C21 updated.",
    direction: "to-erp",
    id: "a5",
    result: "sent",
    what: "Company Kukla Studios",
    when: "09:40",
  },
];

export const WEBSITES = [
  { id: "", label: "Default Config" },
  { id: "base", label: "Main Website" },
  { id: "citisignal", label: "CitiSignal Website" },
  { id: "bodea", label: "Bodea Website" },
  { id: "evo", label: "Evo" },
];
