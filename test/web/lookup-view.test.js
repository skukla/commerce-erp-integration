/*
 * The Lookup card's table (erp/lookup), kept apart from the React that draws it. With one ERP:
 * Commerce beside the ERP, as always. With several: a product beside the ERP that owns it, and
 * a company beside each ERP, since a company can be a customer in several.
 */
import { lookupTable } from "#web/lookup-view.js";

const ERPS = [
  { id: "erp", name: "Northwind ERP" },
  { id: "contoso", name: "Contoso ERP" },
];

const product = (extra = {}) => ({
  erpHash: "#products?open=CAB-RED",
  found: { commerce: true, erp: true },
  key: "CAB-RED",
  kind: "product",
  rows: [{ commerce: "Cabinet", erp: "Cabinet", label: "Name" }],
  ...extra,
});

describe("Given one ERP", () => {
  test("Then the table is Commerce beside the ERP, as before", () => {
    expect(lookupTable(product(), "Northwind ERP", null)).toStrictEqual({
      columns: ["CAB-RED", "Commerce", "Northwind ERP"],
      note: null,
      rows: [
        { cells: ["Cabinet", "Cabinet"], label: "Name" },
        {
          cells: [null, "#products?open=CAB-RED"],
          code: true,
          label: "In Northwind ERP",
        },
      ],
    });
    expect(
      lookupTable(
        product({ erpHash: null, found: { commerce: true, erp: false } }),
        "Northwind ERP",
        null,
      ).columns,
    ).toEqual(["CAB-RED", "Commerce", "Northwind ERP · not found"]);
  });
});

describe("Given several ERPs", () => {
  test("Then a product is shown beside the ERP that owns it, by name", () => {
    const table = lookupTable(
      product({
        owner: { id: "contoso", name: "Contoso ERP" },
        owners: ["contoso"],
      }),
      "Northwind ERP",
      ERPS,
    );
    expect(table.columns).toEqual(["CAB-RED", "Commerce", "Contoso ERP"]);
    expect(table.note).toBe("Contoso ERP owns this product.");
    expect(table.rows.at(-1).label).toBe("In Contoso ERP");
  });

  test("Then a product no ERP owns, or two claim, says so instead of naming one", () => {
    const none = product({
      erpHash: null,
      found: { commerce: true, erp: false },
      owner: null,
      owners: [],
    });
    expect(lookupTable(none, "Northwind ERP", ERPS).note).toBe(
      "No ERP owns this product, so no ERP was asked.",
    );
    expect(lookupTable(none, "Northwind ERP", ERPS).columns[2]).toBe("ERP");
    expect(
      lookupTable(
        { ...none, owners: ["erp", "contoso"] },
        "Northwind ERP",
        ERPS,
      ).note,
    ).toBe(
      "Northwind ERP and Contoso ERP both claim this product; fix the setup. No ERP was asked.",
    );
  });

  test("Then a company is shown beside each ERP, with where it is not a customer", () => {
    const side = (erpId, erpName, erp) => ({
      erpHash: erp ? `#partners?open=${erp}` : null,
      erpId,
      erpName,
      found: { commerce: true, erp: Boolean(erp) },
      key: "7",
      kind: "company",
      rows: [
        { commerce: "Acme", erp: erp ? `Acme (${erp})` : null, label: "Name" },
      ],
    });
    const table = lookupTable(
      {
        erps: [
          side("erp", "Northwind ERP", "C21"),
          side("contoso", "Contoso ERP", null),
        ],
        key: "7",
        kind: "company",
      },
      "Northwind ERP",
      ERPS,
    );
    expect(table).toStrictEqual({
      columns: ["7", "Commerce", "Northwind ERP", "Contoso ERP · not found"],
      note: null,
      rows: [
        { cells: ["Acme", "Acme (C21)", null], label: "Name" },
        {
          cells: [null, "#partners?open=C21", null],
          code: true,
          label: "In the ERP",
        },
      ],
    });
  });
});
