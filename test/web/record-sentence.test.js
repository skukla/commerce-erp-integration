/*
 * The Record column's one grammar (record-sentence.js): "Subject: what happened", from each
 * record's own fields. The event data is in the shape each handler gets it
 * (lib/erp-event-history.js DESCRIBE reads the same fields); stock is a list
 * (stock/external/updated/schema.json).
 */
import { recordSentence } from "#web/record-sentence.js";

/** Words that belong to the ERP and Result columns, not the sentence. */
const OUTCOME_OR_ERP = /ERP|sent|refused|waiting|applied/iu;

const fromErp = (kind, ref, data, extra = {}) => ({
  direction: "from-erp",
  event: { data },
  kind,
  ref,
  ...extra,
});
const own = (kind, ref, extra = {}) => ({
  direction: "to-erp",
  kind,
  ref,
  ...extra,
});

describe("Given a record an ERP sent", () => {
  test.each([
    ["price", "AB1", { price: 189, sku: "AB1" }, "Product AB1: price 189"],
    [
      "stock",
      "AB1",
      [{ outOfStock: false, quantity: 42, sku: "AB1", source: "east" }],
      "Product AB1: 42 in stock at east",
    ],
    [
      "stock",
      "AB1",
      [{ outOfStock: true, quantity: 0, sku: "AB1", source: "east" }],
      "Product AB1: out of stock at east",
    ],
    [
      "stock",
      "",
      [
        { outOfStock: false, quantity: 1, sku: "A", source: "east" },
        { outOfStock: false, quantity: 2, sku: "B", source: "east" },
      ],
      "2 products: stock changed",
    ],
    ["cancel", "300", { incrementId: "300" }, "Order 300: canceled"],
    ["shipment", "300", { incrementId: "300" }, "Order 300: shipped"],
    [
      "invoice",
      "300",
      { incrementId: "300", invoiceNumber: "9" },
      "Order 300: invoiced",
    ],
    ["hold", "300", { held: true }, "Order 300: on credit hold"],
    ["hold", "300", { held: false }, "Order 300: credit hold released"],
    ["order-status", "300", { status: "confirmed" }, "Order 300: confirmed"],
    [
      "payment",
      "300",
      { amount: 1859, currency: "USD" },
      "Order 300: paid 1859 USD",
    ],
    [
      "credit-memo",
      "300",
      { creditMemoNumber: "CM-4" },
      "Order 300: credit memo CM-4",
    ],
    [
      "return",
      "300",
      { returnNumber: "R-2" },
      "Order 300: return order R-2 received",
    ],
  ])(
    "Then %s reads as its subject and what happened",
    (kind, ref, data, sentence) => {
      expect(recordSentence(fromErp(kind, ref, data))).toBe(sentence);
    },
  );

  test("Then a company event names the company by its Commerce name, else the ERP's customer", () => {
    const named = { company: { id: "4", name: "Kukla Studios" } };
    expect(
      recordSentence(
        fromErp("credit", "100051", { creditLimit: 25_000 }, named),
      ),
    ).toBe("Kukla Studios: credit limit 25000");
    expect(
      recordSentence(
        fromErp("block", "100063", { blocked: true, partnerId: "100063" }),
      ),
    ).toBe("Customer 100063: blocked");
    expect(
      recordSentence(
        fromErp(
          "contract",
          "100042",
          { lines: [{}, {}, {}], partnerId: "100042" },
          named,
        ),
      ),
    ).toBe("Kukla Studios: 3 customer prices");
    expect(
      recordSentence(
        fromErp("contract", "100042", { lines: [{}], partnerId: "100042" }),
      ),
    ).toBe("Customer 100042: 1 customer price");
  });

  test("Then a record without the fields its sentence needs falls back to its message", () => {
    expect(recordSentence(fromErp("price", "AB1", { sku: "AB1" }))).toBeNull();
    expect(
      recordSentence(fromErp("stock", "AB1", { erpId: "erp" })),
    ).toBeNull();
    expect(recordSentence(fromErp("unknown-kind", "AB1", {}))).toBeNull();
  });
});

describe("Given a record the integration made", () => {
  test.each([
    [
      own("order", "300", { erpNumber: "NORT-12" }),
      "Order 300: sales order NORT-12",
    ],
    [own("order", "300"), "Order 300"],
    [
      own("changed", "300", {
        message: "Commerce order 300: held on sales order 12",
      }),
      "Order 300: held",
    ],
    [
      own("changed", "300", {
        message:
          "Northwind ERP: Commerce order 300: canceled on sales order 12 Contoso ERP: Commerce order 300: canceled on sales order 4",
        orderRef: "300",
      }),
      "Order 300: canceled",
    ],
    [own("shipped", "11", { orderRef: "300" }), "Shipment 11: order 300"],
    [own("invoiced", "12", { orderRef: "300" }), "Invoice 12: order 300"],
    [own("returned", "4", { orderRef: "300" }), "Return 4: order 300"],
    [own("product-changed", "AB1"), "Product AB1: name and price"],
    [
      { direction: "commerce", kind: "product-deleted", ref: "AB1" },
      "Product AB1: deleted",
    ],
    [
      {
        direction: "reset",
        kind: "reset",
        message:
          "Demo reset on 2026-09-27: 21 orders canceled, 3 noted as closed; the ERPs' changes in Commerce undone. The activity before it was cleared.",
        ref: "2026-09-27",
      },
      "Demo reset: 21 orders canceled, 3 noted as closed",
    ],
  ])(
    "Then it reads as its subject and what happened (%#)",
    (entry, sentence) => {
      expect(recordSentence(entry)).toBe(sentence);
    },
  );

  test("Then no sentence names an ERP or says how it ended: their own columns do", () => {
    const sentences = [
      recordSentence(own("order", "300", { erpNumber: "NORT-12" })),
      recordSentence(own("shipped", "11", { orderRef: "300" })),
      recordSentence(fromErp("shipment", "300", {})),
    ];
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(OUTCOME_OR_ERP);
    }
  });
});
