/*
 * What the Settings tab shows: the fields grouped as a merchant reads them, the scopes
 * they can switch between, and what a Save actually sends.
 */
import {
  pendingChanges,
  scopeChoices,
  settingSections,
} from "#web/settings-view.js";

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
];

const VALUES = [
  { name: "orders_send", origin: "global", value: true },
  { name: "orders_hold_offline", origin: "website", value: false },
  { name: "pricing_contract_prices", origin: "global", value: true },
];

describe("Given the settings a merchant edits", () => {
  test("Then they are grouped by what they are about, in the schema's order", () => {
    const sections = settingSections(FIELDS, VALUES, { scopeLevel: "website" });

    expect(
      sections.map((s) => [s.title, s.fields.map((f) => f.name)]),
    ).toStrictEqual([
      ["Orders", ["orders_send", "orders_hold_offline"]],
      ["Pricing", ["pricing_contract_prices"]],
    ]);
  });

  // Nothing at the Default Config can be CLEARED — there is no wider scope to fall back
  // to — so the page must not offer it there (the first screenshots offered it).
  test("Then a field says whether this scope can clear it", () => {
    const [atDefault] = settingSections(FIELDS, VALUES, {
      scopeLevel: "global",
    });
    const [atWebsite] = settingSections(FIELDS, VALUES, {
      scopeLevel: "website",
    });

    expect(atDefault.fields.map((f) => f.clearable)).toStrictEqual([
      false,
      false,
    ]);
    // Set at this website, so it can go back to the default; the other is inherited.
    expect(atWebsite.fields.map((f) => f.clearable)).toStrictEqual([
      false,
      true,
    ]);
  });

  test("Then each field carries its value and whether it is inherited", () => {
    const [orders] = settingSections(FIELDS, VALUES, { scopeLevel: "website" });

    expect(orders.fields[0]).toStrictEqual({
      clearable: false,
      description: "Orders go to the ERP.",
      inherited: true,
      label: "Send orders",
      name: "orders_send",
      value: true,
    });
    // Set at this scope, so it can be cleared back to the wider scope's value.
    expect(orders.fields[1]).toMatchObject({ inherited: false, value: false });
  });

  // A value the SHOWN scope sets is not inherited; one that arrived from a wider scope is.
  // The comparison is against the scope being shown, not a fixed level — the same field
  // reads as set at a website and inherited at that website's store view.
  test("Then a value set at a wider scope than the one shown is inherited", () => {
    const atStoreView = settingSections(FIELDS, VALUES, {
      scopeLevel: "storeView",
    });

    expect(atStoreView[0].fields.map((f) => f.inherited)).toStrictEqual([
      true,
      true,
    ]);
  });

  // At the Default Config there is nothing wider to inherit from.
  test("Then nothing is inherited at the default scope", () => {
    const [orders] = settingSections(FIELDS, VALUES, { scopeLevel: "global" });

    expect(orders.fields.every((f) => f.inherited === false)).toBe(true);
  });

  test("Then a field the page has no value for falls back to the schema's default", () => {
    const [, pricing] = settingSections(FIELDS, [], { scopeLevel: "website" });

    expect(pricing.fields[0]).toMatchObject({ inherited: true, value: true });
  });
});

describe("Given a save", () => {
  test("Then only what changed is sent", () => {
    const changes = pendingChanges(VALUES, { orders_send: false });

    expect(changes).toStrictEqual({ orders_send: false });
  });

  test("Then a value set back to what it already is sends nothing", () => {
    expect(pendingChanges(VALUES, { orders_send: true })).toStrictEqual({});
  });

  // Null is the library's "use the wider scope's value", which is what Use Default means.
  test("Then clearing a field sends null, so the wider scope decides again", () => {
    expect(pendingChanges(VALUES, { orders_hold_offline: null })).toStrictEqual(
      {
        orders_hold_offline: null,
      },
    );
  });
});

describe("Given the scopes a merchant can pick", () => {
  const TREE = [
    { code: "global", id: "global", level: "global", name: "Default Config" },
    { code: "base", id: "w1", level: "website", name: "Main Website" },
    { code: "default", id: "s1", level: "store", name: "Main Store" },
    { code: "en", id: "v1", level: "storeView", name: "English" },
    { code: "admin", id: "w0", level: "website", name: "Admin" },
  ];

  test("Then Default Config leads, and the Admin website is not offered", () => {
    const choices = scopeChoices(TREE);

    expect(choices.map((c) => c.label)).toStrictEqual([
      "Default Config",
      "Main Website",
      "Main Store",
      "English",
    ]);
    expect(choices[0].id).toBe("");
  });

  test("Then an unsynced tree offers the default alone, not an empty list", () => {
    expect(
      scopeChoices([{ code: "global", id: "global", level: "global" }]),
    ).toStrictEqual([{ id: "", label: "Default Config", level: "global" }]);
    expect(scopeChoices(undefined)).toStrictEqual([
      { id: "", label: "Default Config", level: "global" },
    ]);
  });
});
