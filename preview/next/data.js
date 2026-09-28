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

/*
 * The Mapping section: what each shared thing is called on each side, which system decides,
 * the real settings that shape it (app.commerce.config.ts), and each ERP's part of it. With
 * several ERPs the section shows one ERP at a time, as the ERP switcher on Settings does.
 */

/** The ERPs this integration talks to (sample: two). */
export const ERPS = [
  { color: "#1f6f5c", id: "northwind", name: "Northwind ERP", short: "Northwind" },
  { color: "#a3470c", id: "contoso", name: "Contoso ERP", short: "Contoso" },
];

/**
 * The real settings a mapping row shows: their labels as Settings shows them, and where each
 * is set (`website`: per website, over Default Config; `global`: the whole integration's, at
 * Default Config). Names follow app.commerce.config.ts.
 */
export const MAPPING_SETTINGS = {
  orders_confirm_status: {
    label: "Order status when the ERP confirms",
    scope: "website",
  },
  orders_hold_offline: {
    label: "Hold orders while the ERP is offline",
    scope: "website",
  },
  orders_send: { label: "Send orders to the ERP", scope: "website" },
  structure_order_prefix: {
    label: "Prefix on ERP order numbers in Commerce",
    scope: "global",
  },
  structure_owns: {
    label: "Which products belong to this ERP",
    scope: "global",
  },
  structure_owns_attribute: {
    label: "Product attribute that names this ERP",
    scope: "global",
  },
  structure_sales_org: {
    label: "ERP sales organisation for this website",
    scope: "website",
  },
  structure_sales_org_name: {
    label: "Sales organisation name",
    scope: "website",
  },
};

/** Each ERP's current values, as a chip shows them. */
export const MAPPING_VALUES = {
  contoso: {
    orders_confirm_status: "Blank: a note only",
    orders_hold_offline: "On",
    orders_send: "On",
    structure_order_prefix: "Blank: CONT",
    structure_owns: "By attribute",
    structure_owns_attribute: "erp_owner=demo-erp-2",
    structure_sales_org: "2000",
    structure_sales_org_name: "Blank: the website's name",
  },
  northwind: {
    orders_confirm_status: "erp_confirmed",
    orders_hold_offline: "On",
    orders_send: "On",
    structure_order_prefix: "NORT",
    structure_owns: "By attribute",
    structure_owns_attribute: "erp_owner=demo-erp-1",
    structure_sales_org: "1000",
    structure_sales_org_name: "Bodea Online US",
  },
};

/*
 * One row per thing the two systems share, in the order a business user thinks about them.
 * `decides`: `commerce`, `erp` or `both`. `where`: where it lives in Commerce Admin.
 * `part`: this ERP's part of it, `figure`: a live figure (sample), per ERP.
 * `fields`: [in Commerce, who decides, in the ERP].
 */
export const MAPPING_ROWS = [
  {
    commerce: "Website",
    decides: "commerce",
    erp: "Sales organisation",
    fields: [
      ["Website", "commerce", "Sales organisation"],
      ["Website name", "commerce", "Sales organisation name, when blank"],
      ["Base currency", "commerce", "Order currency"],
    ],
    figure: {
      contoso: { text: "1 website" },
      northwind: { text: "1 website" },
    },
    id: "website",
    part: {
      contoso: "2000 · sells on Bodea Website",
      northwind: "1000 Bodea Online US · sells on Bodea Website",
    },
    sentence:
      "Each website sells through one sales organisation, and the ERP books its orders under it.",
    settings: ["structure_sales_org", "structure_sales_org_name"],
    where: "Stores › All Stores",
  },
  {
    commerce: "Company",
    decides: "both",
    erp: "Customer (business partner)",
    fields: [
      ["Company ID", "commerce", "Customer number: the pairing"],
      ["Company name", "commerce", "Customer name"],
      ["Legal name, VAT/Tax ID, address", "commerce", "Legal identity, address"],
      ["Company admin", "commerce", "Contact person"],
      ["", "erp", "Payment terms"],
      ["Credit limit and credit block", "erp", "Credit limit, credit block"],
    ],
    figure: {
      contoso: { text: "3 of 3 companies paired" },
      northwind: { text: "4 of 4 companies paired" },
    },
    id: "company",
    noSetting: "Paired automatically when a company is saved.",
    part: {
      contoso: "Customers C40 to C42",
      northwind: "Customers C18 to C21",
    },
    sentence:
      "Each company is a customer in the ERP: Commerce keeps the company, the ERP its credit and blocks.",
    settings: [],
    where: "Customers › Companies",
  },
  {
    commerce: "Product",
    decides: "both",
    erp: "Material",
    fields: [
      ["SKU", "commerce", "Material number: the pairing"],
      ["Name", "erp", "Material description"],
      ["Price", "erp", "List price"],
      ["Quantity per source", "erp", "Stock per warehouse"],
      ["Description, images, categories", "commerce", ""],
      ["erp_owner attribute", "commerce", ""],
    ],
    figure: {
      contoso: { text: "64 of 182 products" },
      northwind: { text: "118 of 182 products" },
    },
    id: "product",
    part: {
      contoso: "Products with erp_owner = demo-erp-2",
      northwind: "Products with erp_owner = demo-erp-1",
    },
    sentence:
      "Each product this ERP owns is a material there: the ERP sets its name, list price and stock, Commerce the rest.",
    settings: ["structure_owns", "structure_owns_attribute"],
    where: "Catalog › Products",
  },
  {
    commerce: "Shared catalog price",
    commerceNote: "per company",
    decides: "erp",
    erp: "Customer price list",
    erpNote: "or price group list",
    fields: [
      ["Tier price", "erp", "Price list line"],
      ["Tier price quantity", "erp", "From quantity"],
      ["Published on the start date", "erp", "Line start date"],
      ["Removed on the end date", "erp", "Line end date"],
      ["The company's own shared catalog", "erp", "Customer the list is for"],
      ["Every member company's shared catalog", "erp", "Price group list"],
    ],
    fieldsNote: [
      "A company's own list comes first, then its price group's list, then the product's list price.",
      "Commerce holds one price per product in a catalog, so the price in force is written, not the ERP's rules.",
    ],
    figure: {
      contoso: { text: "1 price list published" },
      northwind: { text: "3 price lists published" },
    },
    id: "prices",
    isNew: true,
    noSetting: "No setting: published whenever a list changes.",
    part: {
      contoso: "1 group list: Distributors",
      northwind: "2 customer lists, 1 group list: Key accounts",
    },
    sentence:
      "Each company's shared catalog carries the prices its ERP list has in force, quantity breaks as tier prices.",
    settings: [],
    where: "Catalog › Shared Catalogs",
  },
  {
    commerce: "Inventory source",
    decides: "erp",
    erp: "Warehouse",
    fields: [
      ["Source", "commerce", "Warehouse: paired per source"],
      ["Source quantity", "erp", "On hand"],
      ["", "erp", "Committed, available"],
      ["Stock moved between sources", "commerce", "Stock transfer"],
    ],
    figure: {
      contoso: { text: "1 source paired" },
      northwind: { text: "2 sources paired" },
    },
    id: "inventory",
    noSetting: "Paired per source.",
    part: {
      contoso: "east ↔ WH-EAST",
      northwind: "north ↔ WH01 · south ↔ WH02",
    },
    sentence:
      "Each inventory source is a warehouse in the ERP, and the ERP's stock sets the source's quantity.",
    settings: [],
    where: "Stores › Sources",
  },
  {
    commerce: "Company credit",
    decides: "erp",
    erp: "Credit limit and credit block",
    fields: [
      ["Credit limit", "erp", "Credit limit"],
      ["Outstanding balance", "erp", "Exposure: open orders and invoices"],
      ["Available credit", "erp", "Available"],
      ["Company on credit block", "erp", "Credit block"],
    ],
    fieldsNote: [
      "With several ERPs, the company's credit limit in Commerce is the total across them.",
    ],
    figure: {
      contoso: { text: "3 companies, none blocked" },
      northwind: { text: "4 companies, 1 on credit block", tone: "notice" },
    },
    id: "credit",
    noSetting: "No setting: the ERP's credit is always followed.",
    part: {
      contoso: "Accounts C40 to C42",
      northwind: "Accounts C18 to C21",
    },
    sentence:
      "The ERP sets each company's credit limit and can block it; Commerce shows it and holds orders to it.",
    settings: [],
    where: "Customers › Companies › Company Credit",
  },
  {
    commerce: "Order",
    decides: "both",
    erp: "Sales order",
    erpNote: "one per ERP",
    fields: [
      ["Order number", "commerce", "Customer reference"],
      ["Items, quantities, prices", "commerce", "Sales order lines"],
      ["Company", "commerce", "Sold-to customer"],
      ["Website", "commerce", "Sales organisation"],
      ["ERP order number", "erp", "Sales order number"],
      ["Status and comment", "erp", "Confirmation"],
      ["Cancellation", "both", "Cancellation with reason"],
    ],
    figure: {
      contoso: { text: "7 sent" },
      northwind: { text: "12 sent, 1 not sent", tone: "negative" },
    },
    id: "order",
    part: {
      contoso: "Its products' lines, numbered CONT-0000001000 on",
      northwind: "Its products' lines, numbered NORT-0000001000 on",
    },
    sentence:
      "Commerce creates the order and the ERP fulfils it; an order with several ERPs' products becomes one sales order in each.",
    settings: [
      "orders_send",
      "orders_hold_offline",
      "structure_order_prefix",
      "orders_confirm_status",
    ],
    where: "Sales › Orders",
  },
  {
    commerce: "Shipment and invoice",
    decides: "erp",
    erp: "Delivery and billing document",
    fields: [
      ["Shipment", "erp", "Delivery"],
      ["Tracking number", "erp", "Carrier tracking"],
      ["Invoice", "erp", "Billing document"],
    ],
    fieldsNote: [
      "The first shipment or invoice moves the order to Processing: Commerce does that itself.",
    ],
    figure: {
      contoso: { text: "2 documents" },
      northwind: { text: "5 documents" },
    },
    id: "documents",
    noSetting: "No setting: every delivery and billing document comes back.",
    part: {
      contoso: "For CONT orders",
      northwind: "For NORT orders",
    },
    sentence:
      "When the ERP delivers or bills, the order gets its shipment or invoice in Commerce.",
    settings: [],
    where: "Sales › Shipments, Invoices",
  },
];
