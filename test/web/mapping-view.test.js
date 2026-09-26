/*
 * What the Mapping tab shows: one card per composite entity (programme plan §5a), two
 * systems side by side, the join and the settings that make it on the card, and what has
 * crossed for it. The settings ARE the mapping (owner, 2026-09-24), so the rules the old
 * Settings tab held — inherited, clearable, default — live here now.
 */
import { CARD_KEYS, mappingCards, syncText } from "#web/mapping-view.js";

const FIELDS = [
  {
    default: true,
    description: "Orders go to the ERP.",
    label: "Send orders",
    name: "orders_send",
    type: "boolean",
  },
  {
    default: true,
    description: "Held while it is offline.",
    label: "Hold orders",
    name: "orders_hold_offline",
    type: "boolean",
  },
  {
    default: true,
    description: "Cart prices come from the ERP.",
    label: "Use contract prices",
    name: "pricing_contract_prices",
    type: "boolean",
  },
  {
    default: "1000",
    description: "The sales organisation for this website.",
    label: "ERP sales organisation for this website",
    name: "structure_sales_org",
    type: "text",
  },
  {
    default: "",
    description: "Prefix on ERP order numbers.",
    label: "Prefix",
    name: "structure_order_prefix",
    type: "text",
  },
  {
    default: "all",
    description: "Which products belong to this ERP.",
    label: "Which products belong to this ERP",
    name: "structure_owns",
    options: [{ label: "All products", value: "all" }],
    type: "list",
  },
  {
    default: false,
    description: "A setting nobody has placed yet.",
    label: "Mystery",
    name: "mystery_flag",
    type: "boolean",
  },
];

// The shape the settings action answers: lib-config's `origin` is the scope a value comes
// from, `{ code, level }` (test/lib/settings.test.js reads the same). These were plain
// strings until 2026-09-26, which is how every website value came to read "Inherited".
const at = (code, level) => ({ code, level });
const VALUES = [
  { name: "orders_send", origin: at("global", "global"), value: true },
  { name: "orders_hold_offline", origin: at("bodea", "website"), value: false },
  {
    name: "pricing_contract_prices",
    origin: at("global", "global"),
    value: true,
  },
  {
    name: "structure_sales_org",
    origin: at("bodea", "website"),
    value: "2000",
  },
];

const STATUS = {
  erp: {
    counts: {
      businessPartners: 5,
      pricingConditions: 6,
      products: 20,
      salesOrders: 8,
    },
    displayName: "Northwind ERP",
    structure: {
      companyCode: { code: "1000", name: "Northwind ERP" },
      salesOrgs: [
        { code: "1000", name: "Online US", websiteCode: "base" },
        { code: "2000", name: "Online EU", websiteCode: "eu" },
      ],
      warehouses: [
        { code: "default", commerceName: "Default Source", name: "Plant 1000" },
        { code: "east", commerceName: "East DC", name: "East DC" },
      ],
    },
  },
};

const HISTORY = [
  {
    direction: "to-erp",
    kind: "order",
    lastAt: "2026-09-24T10:00:00Z",
    outcome: "sent",
  },
  {
    direction: "to-erp",
    kind: "order",
    lastAt: "2026-09-24T10:05:00Z",
    outcome: "held",
  },
  {
    direction: "to-erp",
    kind: "shipped",
    lastAt: "2026-09-24T09:00:00Z",
    outcome: "sent",
  },
  {
    direction: "from-erp",
    kind: "shipment",
    lastAt: "2026-09-24T11:00:00Z",
    outcome: "applied",
  },
  {
    direction: "from-erp",
    kind: "price",
    lastAt: "2026-09-24T08:00:00Z",
    outcome: "refused",
  },
  {
    direction: "from-erp",
    kind: "stock",
    lastAt: "2026-09-24T08:30:00Z",
    outcome: "applied",
  },
  {
    direction: "from-erp",
    kind: "credit",
    lastAt: "2026-09-24T07:00:00Z",
    outcome: "applied",
  },
  {
    direction: "from-erp",
    kind: "block",
    lastAt: "2026-09-24T07:30:00Z",
    outcome: "failed",
  },
];

const cards = (options = {}) =>
  mappingCards({
    erpName: "Northwind ERP",
    fields: FIELDS,
    history: HISTORY,
    scopeLevel: "website",
    status: STATUS,
    values: VALUES,
    ...options,
  });

const byKey = (list, key) => list.find((card) => card.key === key);

const COMPANY_ID = /company id/;
const COMPANY_STATUS = /company status/;
const MASTER_ON_IMPORT = /master on import/;
const NOT_CONNECTED = /not connected yet/i;
const IN_STEP = /^From Northwind ERP: in step, last 2026-09-24T11:00:00Z$/;

describe("Given the composite entities the pair maps", () => {
  test("Then there is one card per concept, in the plan's order, and one for settings nobody placed", () => {
    expect(CARD_KEYS).toStrictEqual([
      "buying",
      "selling",
      "item",
      "price",
      "inventory",
      "credit",
      "order",
      "payment",
      "source",
    ]);
    expect(cards().map((card) => card.key)).toStrictEqual([
      ...CARD_KEYS,
      "other",
    ]);
  });

  test("Then every card names both systems, its join, and rows with the ownership arrow", () => {
    const buying = byKey(cards(), "buying");
    expect(buying.title).toBe("Buying organization");
    expect(buying.systems).toStrictEqual(["Commerce", "Northwind ERP"]);
    expect(buying.join.text).toMatch(COMPANY_ID);
    expect(buying.rows.length).toBeGreaterThan(3);
    for (const row of buying.rows) {
      expect(["→", "←", "↔"]).toContain(row.arrow);
      expect(row.commerce || row.erp).toBeTruthy();
    }
    // The block is the rule the research pinned: both own it, with the rule written under it.
    const block = buying.rows.find((row) =>
      COMPANY_STATUS.test(row.commerce ?? ""),
    );
    expect(block.arrow).toBe("↔");
    expect(block.rule).toMatch(MASTER_ON_IMPORT);
  });

  test("Then the payment card is on the map with no join, saying it is not connected yet", () => {
    const payment = byKey(cards(), "payment");
    expect(payment.join.fields).toStrictEqual([]);
    expect(payment.join.text).toMatch(NOT_CONNECTED);
  });
});

describe("Given the settings a merchant edits", () => {
  test("Then every setting lands on exactly one card, and an unplaced one lands on Other", () => {
    const placed = cards().flatMap((card) =>
      [...card.join.fields, ...card.settings].map((field) => [
        field.name,
        card.key,
      ]),
    );
    expect(Object.fromEntries(placed)).toStrictEqual({
      mystery_flag: "other",
      orders_hold_offline: "order",
      orders_send: "order",
      pricing_contract_prices: "price",
      structure_order_prefix: "order",
      structure_owns: "source",
      structure_sales_org: "selling",
    });
    expect(placed.length).toBe(FIELDS.length);
  });

  test("Then the setting that makes a join sits on the join, not among the card's switches", () => {
    const selling = byKey(cards(), "selling");
    expect(selling.join.fields.map((f) => f.name)).toStrictEqual([
      "structure_sales_org",
    ]);
    const order = byKey(cards(), "order");
    expect(order.join.fields.map((f) => f.name)).toStrictEqual([
      "structure_order_prefix",
    ]);
    expect(order.settings.map((f) => f.name)).toStrictEqual([
      "orders_send",
      "orders_hold_offline",
    ]);
  });

  test("Then a field carries its value, whether it is inherited, and whether this scope can clear it", () => {
    const order = byKey(cards(), "order");
    expect(order.settings[0]).toStrictEqual({
      clearable: false,
      description: "Orders go to the ERP.",
      inherited: true,
      label: "Send orders",
      name: "orders_send",
      type: "boolean",
      value: true,
    });
    // Set at this website, so it can go back to the default.
    expect(order.settings[1]).toMatchObject({
      clearable: true,
      inherited: false,
      value: false,
    });
    // A list field keeps its options, and a field with no value falls back to the default.
    const source = byKey(cards(), "source");
    expect(source.join.fields[0]).toMatchObject({
      inherited: true,
      options: [{ label: "All products", value: "all" }],
      type: "list",
      value: "all",
    });
  });

  // Nothing at the Default Config can be cleared or inherited: there is nothing wider.
  test("Then at the default scope nothing is inherited and nothing is clearable", () => {
    const all = cards({ scopeLevel: "global" }).flatMap((card) => [
      ...card.join.fields,
      ...card.settings,
    ]);
    expect(
      all.every((f) => f.inherited === false && f.clearable === false),
    ).toBe(true);
  });

  test("Then a value set at the website being shown is its own: not inherited, and clearable", () => {
    const order = byKey(cards({ scopeLevel: "website" }), "order");
    const holdOffline = order.settings.find(
      (f) => f.name === "orders_hold_offline",
    );
    const send = order.settings.find((f) => f.name === "orders_send");
    expect(holdOffline).toMatchObject({ clearable: true, inherited: false });
    expect(send).toMatchObject({ clearable: false, inherited: true });
  });

  test("Then a value set at a wider scope than the one shown is inherited", () => {
    const order = byKey(cards({ scopeLevel: "store_view" }), "order");
    expect(order.settings.map((f) => f.inherited)).toStrictEqual([true, true]);
  });
});

describe("Given what has crossed", () => {
  test("Then each card counts its own history per direction, with the last time", () => {
    const order = byKey(cards(), "order");
    expect(order.sync).toStrictEqual({
      fromErp: { lastAt: "2026-09-24T11:00:00Z", notThrough: 0, total: 1 },
      toErp: { lastAt: "2026-09-24T10:05:00Z", notThrough: 1, total: 3 },
    });
    expect(byKey(cards(), "price").sync.fromErp).toStrictEqual({
      lastAt: "2026-09-24T08:00:00Z",
      notThrough: 1,
      total: 1,
    });
    expect(byKey(cards(), "inventory").sync.fromErp.total).toBe(1);
    expect(byKey(cards(), "credit").sync.fromErp.total).toBe(1);
    expect(byKey(cards(), "buying").sync.fromErp).toMatchObject({
      notThrough: 1,
      total: 1,
    });
    expect(byKey(cards(), "selling").sync).toStrictEqual({
      fromErp: { lastAt: null, notThrough: 0, total: 0 },
      toErp: { lastAt: null, notThrough: 0, total: 0 },
    });
  });

  test("Then the sync line reads in words a merchant can act on", () => {
    expect(
      syncText(
        { lastAt: "2026-09-24T10:05:00Z", notThrough: 1, total: 3 },
        "To Northwind ERP",
      ),
    ).toBe("To Northwind ERP: 1 of 3 not through");
    expect(
      syncText(
        { lastAt: "2026-09-24T11:00:00Z", notThrough: 0, total: 1 },
        "From Northwind ERP",
      ),
    ).toMatch(IN_STEP);
    expect(
      syncText({ lastAt: null, notThrough: 0, total: 0 }, "To Northwind ERP"),
    ).toBe("To Northwind ERP: nothing has crossed yet");
  });

  test("Then the ERP's live figures sit on the card they describe", () => {
    const all = cards();
    expect(byKey(all, "buying").figures).toStrictEqual([
      { label: "Business partners in Northwind ERP", value: "5" },
    ]);
    expect(byKey(all, "selling").figures).toStrictEqual([
      {
        label: "Sales organisations",
        value: "1000 · Online US (base), 2000 · Online EU (eu)",
      },
      { label: "Company code", value: "1000 · Northwind ERP" },
    ]);
    expect(byKey(all, "source").figures).toStrictEqual([
      {
        label: "Warehouses",
        value: "default · Plant 1000 (Default Source), east · East DC",
      },
    ]);
    expect(byKey(all, "order").figures).toStrictEqual([
      { label: "Sales orders in Northwind ERP", value: "8" },
    ]);
    // Without a status (the ERP unreachable) a card has no figures, not a crash.
    expect(byKey(cards({ status: null }), "order").figures).toStrictEqual([]);
  });

  test("Then the buying organization and the sellable item offer a look-up, the others do not", () => {
    const all = cards();
    expect(byKey(all, "buying").lookup).toStrictEqual({
      kind: "company",
      label: "Commerce company id",
    });
    expect(byKey(all, "item").lookup).toStrictEqual({
      kind: "sku",
      label: "SKU",
    });
    expect(byKey(all, "order").lookup).toBeNull();
  });

  test("Then each card says where in the ERP's screen its records live", () => {
    expect(byKey(cards(), "order").erpHash).toBe("#orders");
    expect(byKey(cards(), "buying").erpHash).toBe("#partners");
    expect(byKey(cards(), "payment").erpHash).toBeNull();
  });
});
