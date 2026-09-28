/* The ERP list: entries keyed by an id that never changes; the name is only a label. */
import * as demoErp from "#adapters/demo-erp/index";
import {
  adapterFor,
  erpById,
  eventErpId,
  listErps,
  SINGLE_ERP_ID,
} from "#lib/erps";

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

describe("Given an ERP event, which ERP it came from", () => {
  const entry = (id) => ({ adapter: "demo-erp", connection: {}, id, name: id });
  test("Then with one ERP it is that ERP, whatever the event names", () => {
    expect(eventErpId([entry("erp")], undefined)).toBe("erp");
    expect(eventErpId([entry("erp")], "other")).toBe("erp");
  });
  test("Then with several it is the ERP the event names", () => {
    expect(eventErpId([entry("erp"), entry("signs")], "signs")).toBe("signs");
  });
  test("Then with several, an unnamed event is the first ERP's when it is still listed", () => {
    expect(eventErpId([entry("erp"), entry("signs")], undefined)).toBe(
      SINGLE_ERP_ID,
    );
    expect(
      eventErpId([entry("cabinets"), entry("signs")], undefined),
    ).toBeNull();
  });
});
