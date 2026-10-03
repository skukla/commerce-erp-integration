/*
 * Per-ERP settings (Phase B slice B3b, design v1 §2): which products an ERP owns, its
 * order-number prefix and its sales organization (per website) live on that ERP's entry in
 * the ERP list. Anything the entry does not set falls back to the integration's own
 * configuration, so one ERP behaves exactly as before.
 */
import {
  applyErpSettingChanges,
  erpSettingsProblem,
  PER_ERP_KEYS,
  withErpSettings,
} from "#lib/erp-settings";

const BASE = {
  orders_send: true,
  structure_order_prefix: "",
  structure_owns: "all",
  structure_sales_org: "1000",
};

describe("Given an ERP entry's own settings", () => {
  test("Then its values win over the integration's, website values over its defaults, and the rest is the integration's", () => {
    const entry = {
      id: "brand-b",
      settings: {
        structure_order_prefix: "BRB",
        structure_sales_org: "2000",
        websites: { bodea: { structure_sales_org: "2100" } },
      },
    };
    expect(withErpSettings(BASE, entry, "bodea")).toEqual({
      ...BASE,
      structure_order_prefix: "BRB",
      structure_sales_org: "2100",
    });
    expect(withErpSettings(BASE, entry, "base").structure_sales_org).toBe(
      "2000",
    );
    expect(withErpSettings(BASE, entry).orders_send).toBe(true);
  });

  test("Then an entry with no settings leaves the integration's exactly as they are", () => {
    expect(withErpSettings(BASE, { id: "erp" }, "bodea")).toEqual(BASE);
  });

  test("Then only the per-ERP settings can be set on an entry", () => {
    expect(PER_ERP_KEYS).toEqual([
      "structure_owns",
      "structure_owns_sources",
      "structure_owns_attribute",
      "structure_owns_websites",
      "structure_order_prefix",
      "structure_sales_org",
      "structure_sales_org_name",
    ]);
    expect(erpSettingsProblem({ structure_order_prefix: "X" })).toBeNull();
    expect(
      erpSettingsProblem({
        structure_owns: "websites",
        structure_owns_websites: "base, eu",
      }),
    ).toBeNull();
    expect(erpSettingsProblem({ orders_send: false })).toContain("orders_send");
    expect(erpSettingsProblem({ structure_owns: "everything" })).toContain(
      "structure_owns",
    );
    expect(
      erpSettingsProblem({ websites: { bodea: { structure_owns: "all" } } }),
    ).toContain("website");
    expect(erpSettingsProblem({ websites: { "Bad Code": {} } })).toContain(
      "Bad Code",
    );
  });

  test("Then a change sets values, and null removes one so the integration's applies again", () => {
    const next = applyErpSettingChanges(
      { structure_order_prefix: "BRB", structure_sales_org: "2000" },
      undefined,
      { structure_order_prefix: null, structure_owns: "sources" },
    );
    expect(next).toEqual({
      structure_owns: "sources",
      structure_sales_org: "2000",
    });
    expect(
      applyErpSettingChanges(next, "bodea", { structure_sales_org: "2100" }),
    ).toEqual({
      ...next,
      websites: { bodea: { structure_sales_org: "2100" } },
    });
    expect(
      applyErpSettingChanges(
        { websites: { bodea: { structure_sales_org: "2100" } } },
        "bodea",
        { structure_sales_org: null },
      ),
    ).toEqual({});
  });
});
