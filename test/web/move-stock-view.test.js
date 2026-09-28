/*
 * What the product grid's Move stock page says (erp/move-stock): where the move is sent, and
 * what it did. With one ERP, as before; with several, each product goes to the ERP that owns
 * it, so the page names each ERP and the products no one ERP owns.
 */
import { movedSummary, moveIntro } from "#web/move-stock-view.js";

describe("Given the Move stock page", () => {
  test("Then with one ERP it says the move goes to that ERP, as before", () => {
    expect(moveIntro(2, "Northwind ERP", undefined)).toBe(
      "2 products selected. The move is made in Commerce and sent to Northwind ERP at once.",
    );
    expect(
      movedSummary({ erp: "updated", moved: ["A"] }, "Northwind ERP"),
    ).toBe("1 product moved, and Northwind ERP has the new quantities.");
  });

  test("Then with several ERPs it says each product goes to the ERP that owns it", () => {
    expect(
      moveIntro(1, "Northwind ERP", ["Northwind ERP", "Contoso ERP"]),
    ).toBe(
      "1 product selected. The move is made in Commerce and sent at once to the ERP that owns each product (Northwind ERP or Contoso ERP).",
    );
  });

  test("Then after the move it says which ERP has which products, and which none was told", () => {
    expect(
      movedSummary(
        {
          erp: "updated",
          moved: ["C1", "N1", "C2", "ORPHAN"],
          told: [
            { name: "Contoso ERP", skus: ["C1", "C2"] },
            { name: "Northwind ERP", skus: ["N1"] },
          ],
          untold: ["ORPHAN"],
        },
        "Northwind ERP",
      ),
    ).toBe(
      "4 products moved. Contoso ERP has the new quantities of 2 products (C1, C2). " +
        "Northwind ERP has the new quantities of 1 product (N1). " +
        "No ERP owns ORPHAN, so no ERP was told.",
    );
  });
});
