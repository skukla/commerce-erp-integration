/*
 * What the Mapping tab shows, kept apart from the React that renders it (as history-view.js
 * and trace-view.js are): one card per composite entity, two systems side by side.
 *
 * A business concept such as "a buying organization" exists in neither system as one
 * record (programme plan §5a). Each side represents it with a composite of native records,
 * and the concept only exists when both composites are read together through one join. A
 * card draws that: the pieces as rows, the ownership between them as the arrow's direction
 * (Commerce owns → ; the ERP owns ← ; both ↔ with the rule written under it), the join at
 * the top with the setting that makes it editable right there, the card's other switches
 * under the rows, and what has crossed for it from the history. The settings ARE the
 * mapping (owner, 2026-09-24): this replaced the Settings tab, and its rules — inherited,
 * clearable, default — are here now.
 *
 * Rows and ownership follow the composite-entity research's field-ownership summary
 * (`.rptc/research/erp-composite-entities/`, 2026-09-24).
 */

/** The history record kinds each card counts as its own (lib/history.js, lib/erp-event-history.js). */
const ORDER_KINDS = [
  "order",
  "shipped",
  "invoiced",
  "changed",
  "order-status",
  "shipment",
  "invoice",
  "cancel",
  "hold",
];

/** What did not get through (history-view.js keeps the same set for Retry). */
const NOT_THROUGH = new Set(["held", "dropped", "failed", "refused"]);

/**
 * The cards, in the plan's order. `join.fields` and `settings` name the setting fields
 * that belong on the card; a field named nowhere lands on the Other card below.
 */
const CARDS = [
  {
    erpHash: "#partners",
    figures: (erp, erpName) =>
      count(erp?.counts?.businessPartners, `Business partners in ${erpName}`),
    join: { fields: [], text: "Joined by the Commerce company id." },
    key: "buying",
    kinds: ["block"],
    lookup: { kind: "company", label: "Commerce company id" },
    rows: [
      {
        commerce: "company: name, status, admin",
        erp: "business partner (sold-to)",
        owner: "commerce",
      },
      {
        commerce: "company admin and users (customers)",
        erp: null,
        owner: "commerce",
        rule: "the admin's website names the sales organisation the partner sells through",
      },
      {
        commerce: "customer group · shared catalog",
        erp: "customer group id (resolves the walk-in buyer's price)",
        owner: "commerce",
      },
      {
        commerce: "company status (active / blocked)",
        erp: "blocking level (open · shipping · invoicing · all)",
        owner: "both",
        rule: "Commerce's boolean is the master on import; the ERP's level writes back as the boolean, ledgered",
      },
      {
        commerce: "legal name, VAT / tax id, reseller id, address",
        erp: "legal identity",
        owner: "commerce",
      },
      { commerce: null, erp: "payment terms", owner: "erp" },
      {
        commerce: null,
        erp: "sales-organisation memberships",
        owner: "erp",
        rule: "widened by every order the partner places",
      },
    ],
    settings: [],
    title: "Buying organization",
  },
  {
    erpHash: "#settings",
    figures: (erp) => [
      ...list(
        erp?.structure?.salesOrgs,
        "Sales organisations",
        (org) =>
          `${org.code} · ${org.name}${org.websiteCode ? ` (${org.websiteCode})` : ""}`,
      ),
      ...(erp?.structure?.companyCode
        ? [
            {
              label: "Company code",
              value: `${erp.structure.companyCode.code} · ${erp.structure.companyCode.name}`,
            },
          ]
        : []),
    ],
    join: {
      fields: ["structure_sales_org", "structure_sales_org_name"],
      text: "Joined by the sales organisation this website sells through: set it per website with the scope picker.",
    },
    key: "selling",
    kinds: [],
    rows: [
      {
        commerce: "website",
        erp: "sales organisation",
        owner: "both",
        rule: "the per-website setting is the join and is typed once",
      },
      {
        commerce: "stores and store views",
        erp: null,
        owner: "commerce",
        rule: "inherit the website's sales organisation",
      },
      {
        commerce: "base currency and locale (store configuration)",
        erp: "company code currency and country",
        owner: "commerce",
      },
      {
        commerce: "Store Information (address, VAT)",
        erp: "seller identity on the invoice",
        owner: "commerce",
        rule: "not readable over Commerce's REST API; blank on the ERP until it is",
      },
      {
        commerce: null,
        erp: "company code (1000, the ERP itself)",
        owner: "erp",
      },
    ],
    settings: [],
    title: "Selling organization",
  },
  {
    erpHash: "#products",
    figures: (erp, erpName) =>
      count(erp?.counts?.products, `Products in ${erpName}`),
    join: { fields: [], text: "Joined by the SKU." },
    key: "item",
    kinds: [],
    lookup: { kind: "sku", label: "SKU" },
    rows: [
      {
        commerce: "product: SKU, name, type",
        erp: "product",
        owner: "commerce",
      },
      {
        commerce: "configurable parent and its variants",
        erp: "generic article and its variants",
        owner: "commerce",
      },
      {
        commerce: "attributes · website assignment",
        erp: null,
        owner: "commerce",
        rule: "marketing copy stays in Commerce; the ERP keeps one short text",
      },
      {
        commerce: "price",
        erp: "list price",
        owner: "both",
        rule: "imports from Commerce; an ERP edit writes back and returns as the same value",
      },
      { commerce: null, erp: "base unit", owner: "erp" },
      {
        commerce: null,
        erp: "sales status (sellable / blocked for sales)",
        owner: "erp",
        rule: "a blocked product ships nothing; Commerce is not told",
      },
    ],
    settings: [],
    title: "Sellable item",
  },
  {
    erpHash: "#pricing",
    figures: (erp) =>
      count(erp?.counts?.pricingConditions, "Pricing conditions"),
    join: {
      fields: [],
      text: "Joined at cart time by SKU, company and sales organisation: the ERP quotes, Commerce applies.",
    },
    key: "price",
    kinds: ["price"],
    rows: [
      {
        commerce: "cart line price (totals-collector webhook)",
        erp: "contract price",
        owner: "erp",
      },
      {
        commerce: "cart discount",
        erp: "maximum discount (the ceiling)",
        owner: "erp",
      },
      {
        commerce: "shared-catalog custom price · website price",
        erp: null,
        owner: "commerce",
        rule: "stays Commerce's; the ERP's quote replaces the line price only where a contract price applies",
      },
      {
        commerce: null,
        erp: "contract discount · validity · minimum quantity · sales-organisation scope",
        owner: "erp",
      },
    ],
    settings: ["pricing_contract_prices", "pricing_discount_ceiling"],
    title: "Price",
  },
  {
    erpHash: "#products",
    figures: (erp) =>
      count(
        erp?.structure?.warehouses?.length,
        "Warehouses (inventory sources)",
      ),
    join: {
      fields: [],
      text: "Joined by SKU and inventory source code: a warehouse in the ERP is a source in Commerce.",
    },
    key: "inventory",
    kinds: ["stock"],
    rows: [
      {
        commerce: "source item quantity",
        erp: "warehouse on hand",
        owner: "both",
        rule: "last writer wins in either direction; the ERP's writes are ledgered for reversal",
      },
      {
        commerce: "stock per website · salable quantity",
        erp: null,
        owner: "commerce",
      },
      { commerce: null, erp: "committed to open orders", owner: "erp" },
      {
        commerce: null,
        erp: "available (on hand less committed)",
        owner: "erp",
      },
    ],
    settings: [],
    title: "Inventory position",
  },
  {
    erpHash: "#partners",
    figures: () => [],
    join: { fields: [], text: "Joined by the company id (company credit)." },
    key: "credit",
    kinds: ["credit"],
    rows: [
      {
        commerce: "credit limit",
        erp: "credit limit",
        owner: "both",
        rule: "imports from Commerce; written back from the ERP, ledgered",
      },
      {
        commerce: "credit balance (payment on account) · history",
        erp: null,
        owner: "commerce",
        rule: "a separate figure from the ERP's exposure; the two are not compared",
      },
      {
        commerce: null,
        erp: "exposure (net of open orders) · available credit",
        owner: "erp",
      },
      {
        commerce: null,
        erp: "held orders and the credit decision",
        owner: "erp",
      },
    ],
    settings: [],
    title: "Credit",
  },
  {
    erpHash: "#orders",
    figures: (erp, erpName) =>
      count(erp?.counts?.salesOrders, `Sales orders in ${erpName}`),
    join: {
      fields: ["structure_order_prefix"],
      text: "Joined by ext_order_id on the Commerce order: the ERP's number with this pair's prefix in front.",
    },
    key: "order",
    kinds: ORDER_KINDS,
    rows: [
      {
        commerce: "order · items · buyer",
        erp: "sales order · lines · sold-to",
        owner: "commerce",
      },
      {
        commerce: "order status · comments",
        erp: "confirmation · status · notes",
        owner: "erp",
      },
      {
        commerce: "shipments",
        erp: "shipments (posted)",
        owner: "both",
        rule: "made in either system, mirrored once, never echoed",
      },
      { commerce: "invoice", erp: "invoice", owner: "both" },
      {
        commerce: "hold",
        erp: "credit hold",
        owner: "both",
        rule: "an ERP hold puts the order On Hold; a Commerce hold holds the ERP order",
      },
      {
        commerce: "cancellation",
        erp: "cancellation (with its reason)",
        owner: "both",
      },
      {
        commerce: "credit memo",
        erp: null,
        owner: "commerce",
        rule: "not mirrored yet (the way back from invoiced)",
      },
    ],
    settings: ["orders_send", "orders_hold_offline", "orders_confirm_status"],
    title: "Order",
  },
  {
    erpHash: null,
    figures: () => [],
    join: {
      fields: [],
      text: "Not connected yet: order to cash's payment leg is the next slice.",
    },
    key: "payment",
    kinds: [],
    rows: [
      {
        commerce: "invoice payment (capture) · payment transactions",
        erp: null,
        owner: "commerce",
      },
      {
        commerce: "company credit balance and its reimbursements",
        erp: null,
        owner: "commerce",
      },
      { commerce: null, erp: "open item per invoice", owner: "erp" },
      { commerce: null, erp: "incoming payment and clearing", owner: "erp" },
      { commerce: null, erp: "overdue by payment terms", owner: "erp" },
    ],
    settings: [],
    title: "Payment / receivable",
  },
  {
    erpHash: "#settings",
    figures: (erp) =>
      list(
        erp?.structure?.warehouses,
        "Warehouses",
        (w) =>
          `${w.code} · ${w.name}${w.commerceName && w.commerceName !== w.name ? ` (${w.commerceName})` : ""}`,
      ),
    join: {
      fields: [
        "structure_owns",
        "structure_owns_sources",
        "structure_owns_attribute",
      ],
      text: "Joined by the source code. Which products belong to this ERP decides which ERP a source ships for.",
    },
    key: "source",
    kinds: [],
    rows: [
      {
        commerce: "inventory source (code, name)",
        erp: "warehouse (code, the ERP's own name)",
        owner: "both",
        rule: "Commerce keeps its name; the ERP's name is set on its Settings and survives a wipe",
      },
      {
        commerce: "a shipment's source",
        erp: "ship-from warehouse",
        owner: "both",
      },
    ],
    settings: [],
    title: "Fulfilment source",
  },
];

/** Anything not named by a card still has a home. */
const OTHER = {
  erpHash: null,
  figures: () => [],
  join: { fields: [], text: "Settings no card has claimed yet." },
  key: "other",
  kinds: [],
  rows: [],
  settings: [],
  title: "Other settings",
};

export const CARD_KEYS = CARDS.map((card) => card.key);

const ARROW = { both: "↔", commerce: "→", erp: "←" };

function count(value, label) {
  return value === undefined || value === null
    ? []
    : [{ label, value: String(value) }];
}

function list(items, label, text) {
  return Array.isArray(items) && items.length > 0
    ? [{ label, value: items.map(text).join(", ") }]
    : [];
}

/**
 * One setting field as a control shows it: its value at this scope, whether the value is
 * inherited from a wider scope, and whether this scope can clear it back to the default.
 * Inherited means "this scope does not set it"; at Default Config there is nothing wider,
 * so nothing is inherited and nothing is clearable.
 */
function dressField(field, held, scopeLevel) {
  const atDefault = !scopeLevel || scopeLevel === "global";
  // lib-config's origin is the scope a value comes from, `{ code, level }`. A scope's own
  // value has the shown scope's level: a value set further up the path has a wider one.
  const inherited = atDefault ? false : held?.origin?.level !== scopeLevel;
  return {
    clearable: !(atDefault || inherited),
    description: field.description,
    inherited,
    label: field.label,
    name: field.name,
    ...(field.options ? { options: field.options } : {}),
    type: field.type ?? "boolean",
    value: held ? held.value : field.default,
  };
}

/** The later of two ISO times; a first time when there is none yet. */
const later = (at, current) =>
  current === null || at > current ? at : current;

/** The history records a card owns, counted per direction. */
function syncOf(card, history) {
  const own = new Set(card.kinds);
  const empty = () => ({ lastAt: null, notThrough: 0, total: 0 });
  const sync = { fromErp: empty(), toErp: empty() };
  for (const entry of history ?? []) {
    if (!own.has(entry.kind)) {
      continue;
    }
    const side = entry.direction === "from-erp" ? sync.fromErp : sync.toErp;
    side.total += 1;
    if (NOT_THROUGH.has(entry.outcome)) {
      side.notThrough += 1;
    }
    if (typeof entry.lastAt === "string") {
      side.lastAt = later(entry.lastAt, side.lastAt);
    }
  }
  return sync;
}

/**
 * The sync line for one direction, in words a merchant can act on.
 * @param {{ lastAt: string|null, notThrough: number, total: number }} side
 * @param {string} heading "To <ERP>" or "From <ERP>"
 */
export function syncText(side, heading) {
  if (side.total === 0) {
    return `${heading}: nothing has crossed yet`;
  }
  if (side.notThrough > 0) {
    return `${heading}: ${side.notThrough} of ${side.total} not through`;
  }
  return `${heading}: in step, last ${side.lastAt}`;
}

/**
 * The cards as the tab renders them.
 *
 * @param {object} args
 * @param {object[]} args.fields the schema fields the settings action answered
 * @param {object[]} args.values the values at the current scope, each with its origin
 * @param {string} [args.scopeLevel] 'website' | 'store' | 'storeView'; omitted or 'global' is Default Config
 * @param {object|null} args.status the status action's answer (`erp.counts`, `erp.structure`)
 * @param {object[]} args.history the history records (both directions)
 * @param {string} args.erpName what the ERP is called
 * @returns {object[]} one card per concept plus Other, each with `systems`, `join`
 *   (text + dressed fields), `rows` (with arrows), `settings` (dressed), `sync`, `figures`,
 *   `erpHash`, and `lookup` (the look-up the card offers: `{ kind, label }` or null)
 */
export function mappingCards({
  erpName,
  fields,
  history,
  scopeLevel,
  status,
  values,
}) {
  const byName = new Map((values ?? []).map((value) => [value.name, value]));
  const fieldByName = new Map(
    (fields ?? []).map((field) => [field.name, field]),
  );
  const dress = (name) => {
    const field = fieldByName.get(name);
    return field ? [dressField(field, byName.get(name), scopeLevel)] : [];
  };
  const claimed = new Set(
    CARDS.flatMap((card) => [...card.join.fields, ...card.settings]),
  );
  const unclaimed = (fields ?? [])
    .filter((field) => !claimed.has(field.name))
    .map((field) => dressField(field, byName.get(field.name), scopeLevel));
  const erp = status?.erp ?? null;
  return [...CARDS, OTHER].map((card) => ({
    erpHash: card.erpHash,
    figures: erp ? card.figures(erp, erpName) : [],
    join: { fields: card.join.fields.flatMap(dress), text: card.join.text },
    key: card.key,
    lookup: card.lookup ?? null,
    rows: card.rows.map((row) => ({ ...row, arrow: ARROW[row.owner] })),
    settings: card.key === "other" ? unclaimed : card.settings.flatMap(dress),
    sync: syncOf(card, history),
    systems: ["Commerce", erpName],
    title: card.title,
  }));
}
