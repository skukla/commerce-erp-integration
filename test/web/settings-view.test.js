/*
 * The settings' scopes, groups and saves: the scopes a merchant can switch between, which
 * settings each scope can set, how one field shows at a scope, and what a Save sends.
 */
import appConfig from "#app.commerce.config";
import {
  dressField,
  groupsAt,
  pendingChanges,
  SETTING_GROUPS,
  settingsPath,
  websiteChoices,
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
  test("Then every website is offered under Default Config; store views, stores and Admin are not", () => {
    const choices = websiteChoices(BODEA_SCOPE_TREE);

    expect(choices.map((c) => c.label)).toStrictEqual([
      "Default Config",
      "Main Website",
      "CitiSignal Website",
      "Bodea Website",
      "Evo",
    ]);
    expect(choices[0].id).toBe("");
    expect(choices.find((c) => c.label === "Bodea Website")).toStrictEqual({
      id: "website-bodea",
      label: "Bodea Website",
      level: "website",
    });
  });

  test("Then an unsynced tree offers the default alone, not an empty list", () => {
    const onlyDefault = [{ id: "", label: "Default Config", level: "global" }];
    expect(websiteChoices([BODEA_SCOPE_TREE[0]])).toStrictEqual(onlyDefault);
    expect(
      websiteChoices([
        BODEA_SCOPE_TREE[0],
        { ...BODEA_SCOPE_TREE[1], children: [] },
      ]),
    ).toStrictEqual(onlyDefault);
    expect(websiteChoices(undefined)).toStrictEqual(onlyDefault);
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

const FIELD = {
  default: true,
  description: "Orders go to the ERP.",
  label: "Send orders",
  name: "orders_send",
  type: "boolean",
};

describe("Given the settings the section shows", () => {
  test("Then every setting the app declares is in exactly one group, so none is left off the page", () => {
    const declared = appConfig.businessConfig.schema
      .map((field) => field.name)
      .sort();
    const grouped = SETTING_GROUPS.flatMap((group) => group.names);
    expect([...grouped].sort()).toStrictEqual(declared);
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  test("Then Default Config edits every group and a website only the website's", () => {
    expect(groupsAt("global")).toStrictEqual(SETTING_GROUPS);
    expect(groupsAt("website").map((g) => g.legend)).toStrictEqual([
      "Orders",
      "Prices",
      "Sales organisation",
    ]);
  });
});

describe("Given one field at a scope", () => {
  test("Then a value set at a wider scope is inherited and cannot be cleared here", () => {
    const held = {
      name: "orders_send",
      origin: { code: "global", level: "global" },
      value: true,
    };
    expect(dressField(FIELD, held, "website")).toStrictEqual({
      clearable: false,
      description: "Orders go to the ERP.",
      inherited: true,
      label: "Send orders",
      name: "orders_send",
      type: "boolean",
      value: true,
    });
  });

  test("Then a value set at the website shown is its own, and can go back to the default", () => {
    const held = {
      name: "orders_send",
      origin: { code: "bodea", level: "website" },
      value: false,
    };
    expect(dressField(FIELD, held, "website")).toMatchObject({
      clearable: true,
      inherited: false,
      value: false,
    });
  });

  test("Then at Default Config nothing is inherited or clearable, and a missing value shows the default", () => {
    expect(dressField(FIELD, undefined, "global")).toMatchObject({
      clearable: false,
      inherited: false,
      value: true,
    });
  });
});
