/*
 * A price publish's side panel (publish-view.js): the spot-check of what a scheduled publish
 * did, from its Activity record (lib/history.js recordPricePublish).
 */
import {
  priceText,
  publishChanges,
  publishFacts,
  publishProblems,
} from "#web/publish-view.js";

const change = (extra) => ({
  companyId: "4",
  erpId: "erp",
  from: { price: 189, priceType: "fixed" },
  partnerId: "100042",
  quantity: 1,
  sku: "accesspoint",
  to: { price: 179, priceType: "fixed" },
  websiteId: 0,
  ...extra,
});

describe("Given a publish's record", () => {
  test("Then a tier price reads as the catalog writes it, a discount as a percentage, none as None", () => {
    expect(priceText({ price: 1859, priceType: "fixed" })).toBe("1,859.00");
    expect(priceText({ price: 10, priceType: "discount" })).toBe("10% off");
    expect(priceText(null)).toBe("None");
  });

  test("Then each row moved is named by company, SKU and quantity, before and after", () => {
    const rows = publishChanges({
      changes: [
        change(),
        change({ companyId: "9", quantity: 5, websiteId: 2 }),
      ],
      companies: { 4: "Kukla Studios" },
    });
    expect(rows).toStrictEqual([
      {
        label: "Kukla Studios: accesspoint, quantity 1",
        values: ["189.00", "179.00"],
      },
      {
        label: "Company 9: accesspoint, quantity 5, website 2",
        values: ["189.00", "179.00"],
      },
    ]);
  });

  test("Then its counts are one fact each", () => {
    const facts = publishFacts({
      failed: [{}],
      removed: 0,
      skipped: [{}, {}],
      unchanged: 12,
      written: 1,
    });
    expect(facts.map((f) => [f.label, f.values[0]])).toStrictEqual([
      ["Written", "1 price"],
      ["Removed", "0 prices"],
      ["Unchanged", "12 prices"],
      ["Skipped", "2"],
      ["Failed", "1"],
    ]);
  });

  test("Then what was not published says which customer or ERP, and why", () => {
    const lines = publishProblems(
      {
        failed: [
          { erpId: "contoso", error: "the ERP's prices in force answered 503" },
          { erpId: "erp", error: "Commerce refused SKU X", partnerId: "C1" },
        ],
        skipped: [
          {
            erpId: "erp",
            partnerId: "100063",
            reason: "partner 100063 is paired with no Commerce company",
          },
        ],
      },
      (id) => ({ contoso: "Contoso ERP" })[id],
    );
    expect(lines).toStrictEqual([
      "Contoso ERP: the ERP's prices in force answered 503",
      "Customer C1: Commerce refused SKU X",
      "Customer 100063 is paired with no Commerce company",
    ]);
  });
});
