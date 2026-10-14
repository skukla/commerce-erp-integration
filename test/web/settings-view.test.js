/*
 * The settings' scopes, cards and saves: the scopes a merchant can switch between, which card
 * holds each setting, how one field shows at a scope, and what a Save sends.
 */
import appConfig from "#app.commerce.config";
import {
  dressField,
  erpGroupNames,
  groupNames,
  ownerAttributeOf,
  ownershipGap,
  pendingChanges,
  SETTING_GROUPS,
  scheduleNames,
  settingsPath,
  websiteChoices,
  websiteOptions,
} from "#web/settings-view.js";

import { BODEA_SCOPE_TREE } from "./fixtures/bodea-scope-tree.js";

const VALUES = [
  { name: "orders_send", origin: "global", value: true },
  { name: "orders_hold_offline", origin: "website", value: false },
  { name: "orders_confirm_status", origin: "global", value: "" },
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

  // An ERP's value it does not set (settings-view erpValues `own: false`) has nothing to clear.
  test("Then clearing what an ERP does not set is no change", () => {
    const erpValues = [
      { name: "structure_owns", own: false, value: "all" },
      { name: "structure_order_prefix", own: true, value: "CON" },
    ];
    expect(
      pendingChanges(erpValues, {
        structure_order_prefix: null,
        structure_owns: null,
      }),
    ).toStrictEqual({ structure_order_prefix: null });
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

describe("Given the settings the Settings tab shows", () => {
  test("Then every setting the app declares is in exactly one card, so none is left off the page", () => {
    const declared = appConfig.businessConfig.schema
      .map((field) => field.name)
      .sort();
    const grouped = SETTING_GROUPS.flatMap((group) => group.names);
    expect([...grouped].sort()).toStrictEqual(declared);
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  test("Then the schedules card shows what the chosen frequency reads: the minute hourly, the time daily, the day and time weekly, nothing more when off", () => {
    const shown = (enabled, frequency) =>
      scheduleNames(
        new Map([
          ["schedule_prices_enabled", { value: enabled }],
          ["schedule_prices_frequency", { value: frequency }],
        ]),
      );
    expect(shown(true, "hourly")).toStrictEqual([
      "schedule_timezone",
      "schedule_prices_enabled",
      "schedule_prices_frequency",
      "schedule_prices_minute",
    ]);
    expect(shown(true, "daily")).toStrictEqual([
      "schedule_timezone",
      "schedule_prices_enabled",
      "schedule_prices_frequency",
      "schedule_prices_time",
    ]);
    expect(shown(true, "weekly")).toStrictEqual([
      "schedule_timezone",
      "schedule_prices_enabled",
      "schedule_prices_frequency",
      "schedule_prices_weekday",
      "schedule_prices_time",
    ]);
    expect(shown(false, "weekly")).toStrictEqual([
      "schedule_timezone",
      "schedule_prices_enabled",
    ]);
  });

  test("Then each card's settings are its group's, in order", () => {
    expect(groupNames("salesOrg")).toStrictEqual([
      "structure_sales_org",
      "structure_sales_org_name",
    ]);
    expect(groupNames("nothing")).toStrictEqual([]);
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

describe("Given the products settings, so that none is left empty (owner, 2026-10-14)", () => {
  const fieldsOf = (values) =>
    new Map(
      Object.entries(values).map(([name, value]) => [name, { name, value }]),
    );

  test("Then the websites to tick are the store's own, by code, the Admin website left out", () => {
    const options = websiteOptions(BODEA_SCOPE_TREE);
    expect(options.map((o) => o.label)).toStrictEqual(
      websiteChoices(BODEA_SCOPE_TREE)
        .filter((c) => c.level === "website")
        .map((c) => c.label),
    );
    expect(options.every((o) => o.code && o.code !== "admin")).toBe(true);
  });

  test("Then a mode left without what it reads is named against the field to fix", () => {
    expect(
      ownershipGap(
        fieldsOf({ structure_owns: "websites", structure_owns_websites: "" }),
      ),
    ).toMatchObject({ name: "structure_owns_websites" });
    expect(
      ownershipGap(
        fieldsOf({
          structure_owns: "attribute",
          structure_owns_attribute: " ",
        }),
      ),
    ).toMatchObject({ name: "structure_owns_attribute" });
    expect(
      ownershipGap(
        fieldsOf({
          structure_owns: "websites",
          structure_owns_websites: "bodea",
        }),
      ),
    ).toBeNull();
    expect(ownershipGap(fieldsOf({ structure_owns: "all" }))).toBeNull();
  });

  test("Then an ERP's products carry its id in erp_owner by default", () => {
    expect(ownerAttributeOf("contoso")).toBe("erp_owner=contoso");
  });
});

describe("Given one ERP's group (its own settings, under its name)", () => {
  const withMode = (mode) =>
    new Map([["structure_owns", { name: "structure_owns", value: mode }]]);

  test("Then with several ERPs it holds its sales organization, and at Default Config its products", () => {
    expect(
      erpGroupNames({ atDefault: true, several: true }, withMode("all")),
    ).toStrictEqual([
      "structure_sales_org",
      "structure_sales_org_name",
      "structure_owns",
      "structure_order_prefix",
    ]);
    expect(
      erpGroupNames({ atDefault: false, several: true }, withMode("all")),
    ).toStrictEqual(["structure_sales_org", "structure_sales_org_name"]);
  });

  test("Then the attribute or the websites show only under the rule that reads them", () => {
    expect(
      erpGroupNames({ atDefault: true, several: true }, withMode("websites")),
    ).toContain("structure_owns_websites");
    expect(
      erpGroupNames({ atDefault: true, several: true }, withMode("websites")),
    ).not.toContain("structure_owns_attribute");
  });

  test("Then with one ERP its sales organization is the integration's, so its group holds its products only", () => {
    expect(
      erpGroupNames({ atDefault: true, several: false }, withMode("all")),
    ).toStrictEqual(["structure_owns", "structure_order_prefix"]);
    expect(
      erpGroupNames({ atDefault: false, several: false }, withMode("all")),
    ).toStrictEqual([]);
  });
});
