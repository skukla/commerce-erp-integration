/* The ERP list: entries keyed by an id that never changes; the name is only a label. */
import * as demoErp from "#adapters/demo-erp/index";
import { adapterFor, erpById, listErps, SINGLE_ERP_ID } from "#lib/erps";

describe("Given the ERP list of a single-ERP install", () => {
  test("Then it holds one demo ERP, keyed by id, built from the deployed settings", () => {
    const erps = listErps({
      ERP_BASE_URL: "https://erp.example/api",
      ERP_DISPLAY_NAME: "Northwind ERP",
    });
    expect(erps).toStrictEqual([
      {
        adapter: "demo-erp",
        connection: { baseUrl: "https://erp.example/api" },
        id: SINGLE_ERP_ID,
        name: "Northwind ERP",
      },
    ]);
    expect(erpById(erps, "erp")).toBe(erps[0]);
    expect(erpById(erps, "Northwind ERP")).toBeNull();
  });

  test("Then an unnamed ERP reads as the ERP", () => {
    expect(listErps()[0]).toMatchObject({
      connection: { baseUrl: null },
      name: "the ERP",
    });
  });

  test("Then each ERP's kind names its adapter, and an unknown kind is an error", () => {
    expect(adapterFor(listErps()[0])).toBe(demoErp);
    expect(() => adapterFor({ adapter: "sap", id: "erp-2" })).toThrow(
      'No adapter "sap" for ERP erp-2.',
    );
  });
});
