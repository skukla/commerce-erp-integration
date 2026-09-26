/*
 * The settings' scopes and saves: the scopes a merchant can switch between, and what a
 * Save actually sends. How they are shown is mapping-view.test.js.
 */
import {
  pendingChanges,
  scopeChoices,
  settingsPath,
} from "#web/settings-view.js";

import { BODEA_SCOPE_TREE } from "./fixtures/bodea-scope-tree.js";

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
  test("Then every website and store view is offered under Default Config, stores and Admin are not", () => {
    const choices = scopeChoices(BODEA_SCOPE_TREE);

    expect(choices.map((c) => c.label)).toStrictEqual([
      "Default Config",
      "Main Website",
      "Main Website › Default Store View",
      "CitiSignal Website",
      "CitiSignal Website › CitiSignal US",
      "Bodea Website",
      "Bodea Website › Bodea US",
      "Evo",
      "Evo › Evo US",
    ]);
    expect(choices[0].id).toBe("");
    expect(choices.find((c) => c.label === "Bodea Website")).toStrictEqual({
      id: "website-bodea",
      label: "Bodea Website",
      level: "website",
    });
    expect(
      choices.find((c) => c.label === "Bodea Website › Bodea US").level,
    ).toBe("store_view");
  });

  test("Then an unsynced tree offers the default alone, not an empty list", () => {
    const onlyDefault = [{ id: "", label: "Default Config", level: "global" }];
    expect(scopeChoices([BODEA_SCOPE_TREE[0]])).toStrictEqual(onlyDefault);
    expect(
      scopeChoices([
        BODEA_SCOPE_TREE[0],
        { ...BODEA_SCOPE_TREE[1], children: [] },
      ]),
    ).toStrictEqual(onlyDefault);
    expect(scopeChoices(undefined)).toStrictEqual(onlyDefault);
  });
});

describe("Given the address the page reads its settings from", () => {
  test("Then it names the scope and asks for a refresh only when told to", () => {
    expect(settingsPath()).toBe("settings");
    expect(settingsPath("website-bodea")).toBe("settings?scope=website-bodea");
    expect(settingsPath(undefined, { refresh: true })).toBe(
      "settings?refresh=true",
    );
    expect(settingsPath("a b", { refresh: true })).toBe(
      "settings?scope=a+b&refresh=true",
    );
  });
});
