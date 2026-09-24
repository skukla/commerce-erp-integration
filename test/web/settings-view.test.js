/*
 * The settings' scopes and saves: the scopes a merchant can switch between, and what a
 * Save actually sends. How they are shown is mapping-view.test.js.
 */
import { pendingChanges, scopeChoices } from "#web/settings-view.js";

const VALUES = [
  { name: "orders_send", origin: "global", value: true },
  { name: "orders_hold_offline", origin: "website", value: false },
  { name: "pricing_contract_prices", origin: "global", value: true },
];

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
