/*
 * The Data Map's live records (data-map-live.js): which record each row shows, and how each
 * side holds it. The look-ups and the trace are built by the actions' own builders
 * (lib/lookup.js, lib/order-trace.js), so the shapes are the ones the page really gets.
 */
import { companyLookup, productLookup } from "#lib/lookup";
import { buildOrderTrace } from "#lib/order-trace";
import {
  companyRow,
  emptyRow,
  fulfilRow,
  mapPicks,
  NO_RECORD,
  orderRow,
  paymentRow,
  pricesRow,
  productRow,
  stockRow,
  websiteRow,
  websitesOf,
} from "#web/data-map-live.js";

import { BODEA_SCOPE_TREE } from "./fixtures/bodea-scope-tree.js";

const ONE = [{ id: "erp", name: "Northwind ERP" }];
const TWO = [
  { id: "erp", name: "Northwind ERP" },
  { id: "contoso", name: "Contoso ERP" },
];
const KEY_MAP = [
  { commerce: "7", erp: "100042", erpId: "erp", kind: "customer" },
  { commerce: "7", erp: "C-2231", erpId: "contoso", kind: "customer" },
];

describe("Given the Activity records and the key map", () => {
  const history = [
    { direction: "from-erp", kind: "stock", ref: "accesspoint" },
    // Still being sent: no ERP has its sales order yet, so it is not the one shown.
    {
      direction: "to-erp",
      kind: "order",
      outcome: "sending",
      ref: "3000000026",
    },
    { direction: "to-erp", kind: "order", outcome: "sent", ref: "3000000023" },
    {
      company: { id: "9", name: "Kukla Studios" },
      direction: "from-erp",
      event: { data: { lines: [{}, {}], partnerId: "100042" } },
      kind: "contract",
      outcome: "applied",
      ref: "100042",
    },
    {
      direction: "from-erp",
      kind: "payment",
      outcome: "refused",
      ref: "3000000023",
    },
    { direction: "to-erp", kind: "order", outcome: "sent", ref: "3000000001" },
  ];

  test("Then each row picks the newest record of its kind", () => {
    const picks = mapPicks(history, KEY_MAP);
    expect(picks).toMatchObject({
      companyId: "9",
      order: "3000000023",
      payment: null,
      sku: "accesspoint",
    });
    expect(picks.contract.ref).toBe("100042");
  });

  test("Then with no company in Activity, the key map's first customer is shown", () => {
    expect(mapPicks([], KEY_MAP).companyId).toBe("7");
    expect(mapPicks([], []).companyId).toBeNull();
  });
});

describe("Given a company look-up", () => {
  const commerce = { company_name: "Kukla Studios", status: 1 };
  const credit = { credit_limit: 70_000, currency_code: "USD" };

  test("Then Commerce shows its name and limit, and each ERP its own customer and limit", () => {
    const lookup = {
      erps: [
        {
          erpId: "erp",
          ...companyLookup({
            commerce,
            companyId: "7",
            credit,
            erp: { creditLimit: 50_000, id: "100042", name: "Kukla" },
          }),
        },
        {
          erpId: "contoso",
          ...companyLookup({ commerce, companyId: "7", credit, erp: null }),
        },
      ],
      key: "7",
      kind: "company",
    };
    const row = companyRow(lookup, TWO, KEY_MAP);
    const open = { id: "7", kind: "company" };
    expect(row.commerce).toEqual([
      "Kukla Studios",
      "credit limit 70000 USD",
      open,
    ]);
    expect(row.erps.erp).toEqual([
      "Customer 100042",
      "credit limit 50000",
      open,
    ]);
    expect(row.erps.contoso).toEqual([
      "Customer C-2231",
      "no credit limit",
      open,
    ]);
  });

  test("Then with one ERP, a company it has no customer for says so", () => {
    const lookup = companyLookup({
      commerce,
      companyId: "8",
      credit,
      erp: null,
    });
    expect(companyRow(lookup, ONE, KEY_MAP).erps.erp).toEqual([
      null,
      "not a customer here",
      null,
    ]);
  });
});

describe("Given a product look-up", () => {
  const commerce = { name: "Access Point", price: 199, sku: "accesspoint" };
  const erp = {
    available: 987,
    committed: 2,
    listPrice: 199,
    name: "Access Point",
    sku: "accesspoint",
    stock: 989,
    warehouses: [{ code: "main", quantity: 989 }],
  };

  test("Then only the owning ERP holds the item and its stock", () => {
    const lookup = {
      ...productLookup({ commerce, erp, sku: "accesspoint" }),
      owner: { id: "erp", name: "Northwind ERP" },
    };
    const open = { kind: "product", sku: "accesspoint" };
    const product = productRow(lookup, TWO);
    expect(product.commerce).toEqual(["accesspoint", "price 199", open]);
    expect(product.erps.erp).toEqual([
      "Item accesspoint",
      "list price 199",
      open,
    ]);
    expect(product.erps.contoso[1]).toBe("not its product");

    const stock = stockRow(lookup, TWO);
    expect(stock.erps.erp).toEqual([
      "989 on hand",
      "2 committed, 987 available",
      open,
    ]);
    expect(stock.erps.contoso[1]).toBe("not its warehouse");
  });

  test("Then an ERP that does not have it says so, with one ERP or as the owner", () => {
    const missing = productLookup({ commerce, erp: null, sku: "accesspoint" });
    expect(productRow(missing, ONE).erps.erp).toEqual([
      null,
      "not in this ERP",
      null,
    ]);
    const owned = { ...missing, owner: { id: "contoso", name: "Contoso ERP" } };
    expect(stockRow(owned, TWO).erps.contoso).toEqual([
      null,
      "not in this ERP",
      null,
    ]);
    expect(stockRow(owned, TWO).erps.erp[1]).toBe("not its warehouse");
  });
});

describe("Given an order", () => {
  const ref = "3000000023";
  const trace = buildOrderTrace({
    commerceOrder: {
      created_at: "2026-10-13 10:00:00",
      increment_id: ref,
      status: "pending",
    },
    crossings: [],
    erpName: "Northwind ERP and Contoso ERP",
    erpOrders: [
      {
        erpName: "Northwind ERP",
        erpOrder: { number: "0000001013", status: "confirmed" },
        number: "0000001013",
      },
      {
        erpName: "Contoso ERP",
        erpOrder: { number: "0000001002", status: "invoiced" },
        number: "0000001002",
      },
    ],
    incrementId: ref,
  });

  test("Then Commerce shows its status, and each ERP its own sales order", () => {
    const row = orderRow(ref, trace, TWO);
    const open = { kind: "trace", ref };
    expect(row.commerce).toEqual([`Order ${ref}`, "pending", open]);
    expect(row.erps.erp).toEqual(["Sales order 0000001013", "confirmed", open]);
    expect(row.erps.contoso).toEqual([
      "Sales order 0000001002",
      "invoiced",
      open,
    ]);
  });

  test("Then shipping and invoicing come from each ERP's own events", () => {
    const history = [
      {
        direction: "from-erp",
        erpIds: ["contoso"],
        kind: "invoice",
        lastAt: "2026-10-13T13:20:00Z",
        ref,
      },
      {
        direction: "from-erp",
        erpIds: ["contoso"],
        kind: "shipment",
        lastAt: "2026-10-13T13:12:00Z",
        ref,
      },
    ];
    const row = fulfilRow(ref, history, TWO, "UTC");
    expect(row.commerce[1]).toBe("1 of 2 parts shipped, 1 of 2 parts invoiced");
    expect(row.erps.contoso.slice(0, 2)).toEqual([
      "Shipped 1:12 PM",
      "invoiced 1:20 PM",
    ]);
    expect(row.erps.erp.slice(0, 2)).toEqual([
      "Not shipped yet",
      "not invoiced",
    ]);
  });
});

describe("Given an ERP's price list and payment in Activity", () => {
  test("Then the price list names the company and how many prices it holds", () => {
    const row = pricesRow(
      {
        company: { id: "9", name: "Kukla Studios" },
        erpIds: ["contoso"],
        event: { data: { lines: [{}, {}, {}], partnerId: "C-2231" } },
      },
      TWO,
    );
    expect(row.commerce.slice(0, 2)).toEqual([
      "Kukla Studios",
      "3 company prices",
    ]);
    expect(row.erps.contoso.slice(0, 2)).toEqual([
      "Price list for C-2231",
      "3 prices in force",
    ]);
    expect(row.erps.erp[1]).toBe("no prices for this company");
  });

  test("Then a payment shows on its order, from the ERP that posted it", () => {
    const row = paymentRow(
      {
        event: { data: { amount: 1859, paymentNumber: "P-17" } },
        ref: "3000000023",
      },
      ONE,
    );
    expect(row.commerce.slice(0, 2)).toEqual(["Order 3000000023", "paid 1859"]);
    expect(row.erps.erp.slice(0, 2)).toEqual([
      "Payment P-17",
      "1859 against its invoice",
    ]);
  });
});

describe("Given the websites and each ERP's sales organizations", () => {
  const websites = websitesOf(BODEA_SCOPE_TREE);

  test("Then the websites leave out Admin", () => {
    expect(websites.map((w) => w.code)).not.toContain("admin");
    expect(websites.length).toBeGreaterThan(0);
  });

  test("Then the website shown is one an ERP sets a sales organization for", () => {
    const { code } = websites[1];
    const row = websiteRow(
      websites,
      {
        contoso: { websites: {} },
        erp: {
          websites: {
            [code]: {
              structure_sales_org: "1100",
              structure_sales_org_name: "B2B",
            },
          },
        },
      },
      TWO,
    );
    expect(row.commerce.slice(0, 2)).toEqual([
      websites[1].label,
      `code ${code}`,
    ]);
    expect(row.erps.erp.slice(0, 2)).toEqual(["Sales org 1100", "B2B"]);
    expect(row.erps.contoso[1]).toBe("no sales organization");
  });

  test("Then the website most ERPs file under a sales organization wins", () => {
    const [first, second] = websites;
    const row = websiteRow(
      websites,
      {
        contoso: {
          websites: {
            [first.code]: { structure_sales_org: "2000" },
            [second.code]: { structure_sales_org: "2000" },
          },
        },
        erp: { websites: { [second.code]: { structure_sales_org: "1100" } } },
      },
      TWO,
    );
    expect(row.commerce[0]).toBe(second.label);
  });

  test("Then with no websites, the row is empty", () => {
    expect(websiteRow([], {}, ONE)).toEqual(emptyRow(ONE));
    expect(emptyRow(ONE).commerce[1]).toBe(NO_RECORD);
  });
});
