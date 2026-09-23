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
            products: 182,
            salesOrders: 12,
          },
          displayName: "Northwind ERP",
          lastImportAt: "2026-09-22T09:12:04.000Z",
          lastWipeAt: "2026-09-21T19:11:14.000Z",
          reachable: true,
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
