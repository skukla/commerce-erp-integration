import { companyLookup, productLookup } from "#lib/lookup";

/*
 * Stand-in answers for the Admin page's actions, in the shapes the actions really return
 * (erp/status, erp/settings, erp/history — see each action). The preview renders the real
 * components against these, so the layout can be looked at without a Commerce Admin, a
 * sign-in, or a deployed app.
 */
const SETTINGS_FIELDS = [
  {
    default: true,
    description:
      "Orders placed on this website are created in the ERP, and the ERP's order number is written back.",
    label: "Send orders to the ERP",
    name: "orders_send",
    type: "boolean",
  },
  {
    default: true,
    description:
      "An order placed while the ERP is offline is sent when the ERP is back (retried for up to a day). When off, such an order is not sent.",
    label: "Hold orders while the ERP is offline",
    name: "orders_hold_offline",
    type: "boolean",
  },
  {
    default: true,
    description:
      "When the ERP confirms an order, its Commerce status becomes Processing.",
    label: "Mark orders Processing when the ERP confirms them",
    name: "orders_status_on_confirm",
    type: "boolean",
  },
  {
    default: true,
    description:
      "Cart prices come from the ERP's contract prices for the buyer's company.",
    label: "Use ERP contract prices in the cart",
    name: "pricing_contract_prices",
    type: "boolean",
  },
  {
    default: true,
    description:
      "A cart discount larger than the ERP allows for the buyer is reduced to the ERP's limit.",
    label: "Apply the ERP's maximum discount",
    name: "pricing_discount_ceiling",
    type: "boolean",
  },
  {
    default: "1000",
    description:
      "The ERP sales organisation that sells through this website (four letters or digits, like an SAP sales org). Orders from this website carry it.",
    label: "ERP sales organisation for this website",
    name: "structure_sales_org",
    type: "text",
  },
  {
    default: "",
    description:
      "What the ERP calls that sales organisation. Blank: the ERP prints the website's name.",
    label: "Sales organisation name",
    name: "structure_sales_org_name",
    type: "text",
  },
  {
    default: "",
    description:
      "Put in front of the ERP order number written onto Commerce orders, as ACME-0000001042, so two ERPs on one store tell their orders apart. Blank: the first four letters of the ERP's name. Set at Default Config.",
    label: "Prefix on ERP order numbers in Commerce",
    name: "structure_order_prefix",
    type: "text",
  },
  {
    default: "all",
    description:
      "Which products belong to this ERP. All: every product (one ERP). Inventory sources: the products stocked in the sources named below. Attribute: the products whose attribute names this ERP. Set at Default Config.",
    label: "Which products belong to this ERP",
    name: "structure_owns",
    options: [
      { label: "All products", value: "all" },
      {
        label: "Products in the inventory sources named below",
        value: "sources",
      },
      { label: "Products whose attribute names this ERP", value: "attribute" },
    ],
    type: "list",
  },
  {
    default: "",
    description:
      "Comma-separated inventory source codes this ERP ships from (used with Inventory sources above).",
    label: "Inventory sources this ERP ships from",
    name: "structure_owns_sources",
    type: "text",
  },
  {
    default: "",
    description:
      "A product attribute and value that names this ERP, as erp_owner=ACME (used with Attribute above).",
    label: "Product attribute that names this ERP",
    name: "structure_owns_attribute",
    type: "text",
  },
];

const SCOPES = [
  { code: "global", id: "global", level: "global", name: "Default Config" },
  { code: "bodea", id: "w1", level: "website", name: "Bodea" },
  { code: "bodea_store", id: "s1", level: "store", name: "Bodea Store" },
  { code: "bodea_us", id: "v1", level: "storeView", name: "Bodea US" },
];

const HISTORY = [
  {
    attempts: 1,
    direction: "to-erp",
    kind: "order",
    lastAt: "2026-09-22T14:05:00Z",
    message: "order 000000048 is ERP sales order 0000001071.",
    outcome: "sent",
    ref: "000000048",
  },
  {
    attempts: 3,
    direction: "to-erp",
    kind: "order",
    lastAt: "2026-09-22T13:40:00Z",
    message: "order 000000047 is waiting for Northwind ERP.",
    outcome: "held",
    ref: "000000047",
  },
  {
    attempts: 1,
    direction: "from-erp",
    eventId: "ev-77",
    kind: "shipment",
    lastAt: "2026-09-22T13:10:00Z",
    message: "order 000000046: shipped",
    outcome: "applied",
    ref: "000000046",
  },
  {
    attempts: 2,
    direction: "from-erp",
    eventId: "ev-76",
    kind: "credit",
    lastAt: "2026-09-22T12:55:00Z",
    message: "company 7: credit limit 50000 — not applied: company not found",
    outcome: "refused",
    ref: "7",
  },
  {
    attempts: 1,
    direction: "from-erp",
    eventId: "ev-75",
    kind: "price",
    lastAt: "2026-09-22T12:30:00Z",
    message: "SKU CS-ROUTER-11: price 199",
    outcome: "applied",
    ref: "CS-ROUTER-11",
  },
];

const TRACE = {
  steps: [
    {
      at: "2026-09-22T13:38:00Z",
      what: "Order 000000047 placed",
      where: "commerce",
    },
    {
      at: "2026-09-22T13:40:00Z",
      detail: "order 000000047 is waiting for Northwind ERP.",
      outcome: "held",
      retry: { incrementId: "000000047" },
      tries: 3,
      what: "Waiting for Northwind ERP",
      where: "integration",
    },
  ],
  summary: {
    commerceStatus: "pending",
    erpNumber: null,
    erpStatus: null,
    incrementId: "000000047",
    reachedErp: false,
  },
};

const values = new Map();

/* The look-up, arranged by the real module from stand-in records: the shapes stay honest. */
const LOOKUP_PRODUCT = {
  commerce: {
    name: "Wireless router",
    price: 199,
    sku: "CS-ROUTER-11",
    status: 1,
    type_id: "simple",
  },
  erp: {
    available: 37,
    committed: 5,
    listPrice: 199,
    name: "Wireless router",
    salesStatus: "sellable",
    sku: "CS-ROUTER-11",
    stock: 42,
    type: "simple",
    unit: "EA",
    warehouses: [{ code: "default", quantity: 42 }],
  },
};
const LOOKUP_COMPANY = {
  commerce: {
    company_name: "Contoso Supply",
    id: 7,
    legal_name: "Contoso Supply Inc.",
    status: 1,
    vat_tax_id: "US 91-7654321",
  },
  credit: { balance: -1200, credit_limit: 120_000, currency_code: "USD" },
  erp: {
    blocking: "open",
    commerceCompanyId: "7",
    credit: { available: 118_800, exposure: 1200, limit: 120_000 },
    creditLimit: 120_000,
    id: "C000102",
    legalName: "Contoso Supply Inc.",
    name: "Contoso Supply",
    paymentTerms: "NET60",
    salesOrgs: ["1000", "2000"],
    vatTaxId: "US 91-7654321",
  },
};
function fakeLookup(query) {
  if (query.sku !== undefined) {
    const known = query.sku === LOOKUP_PRODUCT.commerce.sku;
    return productLookup({
      commerce: known ? LOOKUP_PRODUCT.commerce : null,
      erp: known ? LOOKUP_PRODUCT.erp : null,
      sku: query.sku,
      sourceCodes: known ? ["default"] : [],
    });
  }
  const known = String(query.company) === "7";
  return companyLookup({
    commerce: known ? LOOKUP_COMPANY.commerce : null,
    companyId: String(query.company),
    credit: known ? LOOKUP_COMPANY.credit : null,
    erp: known ? LOOKUP_COMPANY.erp : null,
  });
}

export function fakeApi() {
  return {
    history: (failedOnly) =>
      Promise.resolve({
        entries: failedOnly
          ? HISTORY.filter((e) =>
              ["held", "dropped", "failed", "refused"].includes(e.outcome),
            )
          : HISTORY,
      }),
    lookup: (query) => Promise.resolve(fakeLookup(query)),
    refreshPartners: () => Promise.resolve({ partners: 5 }),
    reset: () => Promise.resolve({ wiped: { products: 182 } }),
    retry: () => Promise.resolve({ outcome: "sent" }),
    saveSettings: (scope, changes) => {
      for (const [name, value] of Object.entries(changes)) {
        if (value === null) {
          values.delete(`${scope}:${name}`);
        } else {
          values.set(`${scope}:${name}`, value);
        }
      }
      return Promise.resolve(settingsPage(scope));
    },
    settings: (scope) => Promise.resolve(settingsPage(scope)),
    status: () =>
      Promise.resolve({
        erp: {
          counts: {
            businessPartners: 5,
            events: 0,
            pricingConditions: 6,
            products: 182,
            salesOrders: 12,
          },
          displayName: "Northwind ERP",
          lastImportAt: "2026-09-22T09:12:04.000Z",
          lastWipeAt: "2026-09-21T19:11:14.000Z",
          reachable: true,
          // The selling structure as the ERP's health answers it (demo-erp lib/structure.js).
          structure: {
            companyCode: { code: "1000", name: "Northwind ERP" },
            salesOrgs: [
              { code: "1000", name: "Online US", websiteCode: "bodea" },
            ],
            warehouses: [
              {
                code: "default",
                commerceName: "Default Source",
                name: "Plant 1000 · Seattle DC",
              },
              { code: "east", commerceName: "East DC", name: "East DC" },
            ],
          },
          sync: null,
        },
        ledger: { entries: 2 },
      }),
    syncRecords: () => Promise.resolve({ accepted: true }),
    trace: () => Promise.resolve({ trace: TRACE }),
  };
}

function settingsPage(scope) {
  const level = SCOPES.find((s) => s.id === scope)?.level ?? "global";
  return {
    fields: SETTINGS_FIELDS,
    scope: scope ?? "global",
    scopes: SCOPES,
    values: SETTINGS_FIELDS.map((field) => {
      const held = values.get(`${scope}:${field.name}`);
      return held === undefined
        ? { name: field.name, origin: "global", value: field.default }
        : { name: field.name, origin: level, value: held };
    }),
  };
}
