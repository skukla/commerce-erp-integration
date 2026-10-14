/*
 * What the Settings tab edits (settings-targets.js): the integration's settings and, with
 * several ERPs, each ERP's own, each saved by its own path (owner, 2026-10-14: an ERP's
 * settings under its name, not behind a switcher).
 */
import {
  anyChanges,
  editOf,
  firstGap,
  INTEGRATION,
  settingsTargets,
} from "#web/settings-targets.js";

const PAGE = {
  fields: [
    { name: "orders_send", type: "boolean" },
    { name: "structure_sales_org", type: "text" },
    { name: "structure_owns", options: [], type: "list" },
    { name: "structure_owns_websites", type: "text" },
  ],
  values: [
    { name: "orders_send", value: true },
    { name: "structure_sales_org", value: "1000" },
    { name: "structure_owns", value: "all" },
    { name: "structure_owns_websites", value: "" },
  ],
};
const NORTHWIND = { id: "erp", name: "Northwind ERP", settings: {} };
const CONTOSO = {
  id: "contoso",
  name: "Contoso ERP",
  settings: { structure_sales_org: "2000" },
};
const SEVERAL = { erps: [NORTHWIND, CONTOSO], several: true };
const ONE = { erps: [NORTHWIND], several: false };

const targetsOf = (edits, erpInfo = SEVERAL) =>
  settingsTargets({
    edits,
    entries: erpInfo.erps,
    erpInfo,
    page: PAGE,
    scopeLevel: "global",
  });

describe("Given the settings at Default Config", () => {
  test("Then with several ERPs there is the integration, then each ERP, each with its own values", () => {
    const targets = targetsOf({});
    expect(targets.map((t) => t.id)).toStrictEqual([
      INTEGRATION,
      "erp",
      "contoso",
    ]);
    expect(targets[2].fields.get("structure_sales_org").value).toBe("2000");
    expect(anyChanges(targets)).toBe(false);
  });

  test("Then with one ERP its settings are the integration's, and there is no target of its own", () => {
    const targets = targetsOf({}, ONE);
    expect(targets.map((t) => t.id)).toStrictEqual([INTEGRATION]);
    expect(targets[0].erp).toBe(NORTHWIND);
  });

  test("Then an edit is saved by its own target only", () => {
    const targets = targetsOf({ contoso: { structure_sales_org: "3000" } });
    expect(targets.map((t) => t.changes)).toStrictEqual([
      {},
      {},
      { structure_sales_org: "3000" },
    ]);
  });
});

describe("Given an edit", () => {
  test("Then an ERP's own products setting cleared is unset, the integration's stays blank", () => {
    const [integration, northwind] = targetsOf({});
    expect(editOf(northwind, {}, "structure_owns", "")).toStrictEqual({
      structure_owns: null,
    });
    expect(editOf(integration, {}, "structure_owns", "")).toStrictEqual({
      structure_owns: "",
    });
  });

  test("Then picking by attribute fills in the attribute the ERP's products carry", () => {
    const [, , contoso] = targetsOf({});
    expect(editOf(contoso, {}, "structure_owns", "attribute")).toStrictEqual({
      structure_owns: "attribute",
      structure_owns_attribute: "erp_owner=contoso",
    });
  });

  test("Then a rule left without its websites is named against its target and field", () => {
    const targets = targetsOf({ contoso: { structure_owns: "websites" } });
    expect(firstGap(targets)).toMatchObject({
      name: "structure_owns_websites",
      target: "contoso",
    });
  });
});
