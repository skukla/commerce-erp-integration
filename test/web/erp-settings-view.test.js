/*
 * The Admin page's per-ERP settings (Phase B slice B3b, design v1 §2): with several ERPs the
 * Settings section gets an ERP switcher; an ERP's own settings (which products it owns, its
 * prefix, its sales organization) are edited on its entry, and what it does not set shows as
 * inherited from the integration's configuration.
 */
import { PER_ERP_KEYS } from "#lib/erp-settings";
import {
  dressErpField,
  ERP_SETTING_NAMES,
  erpChoices,
  erpGroupsAt,
  erpValues,
  websiteCodeOf,
} from "#web/settings-view.js";

import { BODEA_SCOPE_TREE } from "./fixtures/bodea-scope-tree.js";

const ERPS = [
  { id: "brand-a", name: "Brand A ERP" },
  {
    id: "brand-b",
    name: "Brand B ERP",
    settings: {
      structure_order_prefix: "BRB",
      websites: { bodea: { structure_sales_org: "2100" } },
    },
  },
];
const PAGE_VALUES = [
  { name: "structure_order_prefix", value: "" },
  { name: "structure_sales_org", value: "1000" },
  { name: "structure_owns", value: "all" },
];

describe("Given the ERP list", () => {
  test("Then the page's per-ERP names are the integration's per-ERP settings", () => {
    expect(ERP_SETTING_NAMES).toEqual(PER_ERP_KEYS);
  });

  test("Then one ERP offers no switcher, and several offer the integration then each ERP by name", () => {
    expect(erpChoices([ERPS[0]])).toEqual([]);
    expect(erpChoices(ERPS)).toEqual([
      { id: "", label: "Every ERP (the integration's settings)" },
      { id: "brand-a", label: "Brand A ERP" },
      { id: "brand-b", label: "Brand B ERP" },
    ]);
  });

  test("Then an ERP's groups hold only its own settings: every one at Default Config, the sales organization at a website", () => {
    expect(erpGroupsAt("global").map((g) => g.legend)).toEqual([
      "Sales organization",
      "Products and order numbers",
    ]);
    expect(erpGroupsAt("website").map((g) => [g.legend, g.names])).toEqual([
      [
        "Sales organization",
        ["structure_sales_org", "structure_sales_org_name"],
      ],
    ]);
  });

  test("Then a scope id reads as its website's code", () => {
    // The fixture's node ids are `<level>-<code>` (bodea-scope-tree.js, node()).
    expect(websiteCodeOf(BODEA_SCOPE_TREE, "website-bodea")).toBe("bodea");
    expect(websiteCodeOf(BODEA_SCOPE_TREE, "")).toBeUndefined();
  });

  test("Then an ERP's values are its own where it sets them, and the integration's otherwise", () => {
    const atDefault = erpValues(ERPS[1], undefined, PAGE_VALUES);
    expect(atDefault.find((v) => v.name === "structure_order_prefix")).toEqual({
      name: "structure_order_prefix",
      own: true,
      value: "BRB",
    });
    expect(atDefault.find((v) => v.name === "structure_sales_org")).toEqual({
      name: "structure_sales_org",
      own: false,
      value: "1000",
    });
    const atBodea = erpValues(ERPS[1], "bodea", PAGE_VALUES);
    expect(atBodea.find((v) => v.name === "structure_sales_org")).toMatchObject(
      {
        own: true,
        value: "2100",
      },
    );
  });

  test("Then a field the ERP does not set shows as inherited, and one it sets can go back to the integration's", () => {
    const field = {
      label: "Prefix",
      name: "structure_order_prefix",
      type: "text",
    };
    expect(dressErpField(field, { own: false, value: "" })).toMatchObject({
      clearable: false,
      inherited: true,
      value: "",
    });
    expect(dressErpField(field, { own: true, value: "BRB" })).toMatchObject({
      clearable: true,
      inherited: false,
      value: "BRB",
    });
  });
});
