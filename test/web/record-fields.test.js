/*
 * The log's columns for one record (record-fields.js): the record in Commerce and in the ERP,
 * each named, and a plain phrase for what happened in the system it came from. The event data
 * is in the shape each handler gets it (lib/erp-event-history.js DESCRIBE reads the same
 * fields); stock is a list (stock/external/updated/schema.json). Messages are the real
 * writers' wording.
 */
import { recordFields, recordLine } from "#web/record-fields.js";

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
const shown = (entry) => {
  const f = recordFields(entry);
  return f && [f.commerce, f.erp, f.details];
};

describe("Given the record's two sides", () => {
  // "In the ERP" is always the ERP's record for the same thing; a product is one SKU on both
  // sides, so its ERP side is empty, and a missing side is named where that is the point.
  test("Then an unpaired company and an order no ERP holds say so", () => {
    expect(
      recordFields(
        fromErp("block", "100063", { blocked: true, partnerId: "100063" }),
      ).missing,
    ).toStrictEqual({ commerce: "Not paired" });
    expect(
      recordFields(own("order", "300", { outcome: "held" })).missing,
    ).toStrictEqual({
      erp: "Not in the ERP yet",
    });
    expect(
      recordFields(own("order", "300", { outcome: "dropped" })).missing,
    ).toStrictEqual({
      erp: "Not in the ERP",
    });
    expect(
      recordFields(own("order", "300", { erpNumber: "12", outcome: "sent" }))
        .missing,
    ).toStrictEqual({});
  });
});

describe("Given a record an ERP sent", () => {
  test.each([
    // AB-60: each changed field with what it was; a rename is a rename, not a price change.
    [
      "product",
      { changed: ["price"], previous: { price: 180 }, price: 189, sku: "AB1" },
      ["AB1", "", "Price changed from 180.00 to 189.00"],
    ],
    [
      "product",
      {
        changed: ["name"],
        name: "Aurora Tote",
        previous: { name: "Tote" },
        sku: "AB1",
      },
      ["AB1", "", 'Name changed from "Tote" to "Aurora Tote"'],
    ],
    [
      "stock",
      [{ outOfStock: false, quantity: 1042, sku: "AB1", source: "east" }],
      ["AB1", "", "Stock changed to 1,042 at east"],
    ],
    [
      "stock",
      [{ outOfStock: true, quantity: 0, sku: "AB1", source: "east" }],
      ["AB1", "", "Out of stock at east"],
    ],
    [
      "stock",
      [
        { outOfStock: false, quantity: 1, sku: "A", source: "east" },
        { outOfStock: false, quantity: 2, sku: "B", source: "east" },
      ],
      ["", "", "Stock changed for 2 products"],
    ],
    [
      "cancel",
      { erpNumber: "12" },
      ["Order 300", "Sales order 12", "Order canceled"],
    ],
    ["shipment", {}, ["Order 300", "", "Order shipped"]],
    ["invoice", { invoiceNumber: "9" }, ["Order 300", "", "Invoice 9 issued"]],
    ["hold", { held: true }, ["Order 300", "", "Credit hold placed"]],
    ["hold", { held: false }, ["Order 300", "", "Credit hold released"]],
    [
      "order-status",
      { status: "confirmed" },
      ["Order 300", "", "Order confirmed"],
    ],
    [
      "payment",
      { amount: 1859, currency: "USD", paymentNumber: "P-17" },
      ["Order 300", "", "Payment P-17 of 1,859.00 USD received"],
    ],
    [
      "credit-memo",
      { creditMemoNumber: "CM-4" },
      ["Order 300", "", "Credit memo CM-4 issued"],
    ],
    [
      "return",
      { returnNumber: "R-2" },
      ["Order 300", "", "Return order R-2 received"],
    ],
  ])("Then %s shows both sides and what happened", (kind, data, expected) => {
    const ref = Array.isArray(data) ? (data[0]?.sku ?? "") : "300";
    expect(shown(fromErp(kind, ref, data))).toStrictEqual(expected);
  });

  test("Then a company is its Commerce name beside the ERP's customer, or none when unpaired", () => {
    const named = { company: { id: "4", name: "Kukla Studios" } };
    expect(
      shown(
        fromErp(
          "credit",
          "100051",
          { creditLimit: 25_000, partnerId: "100051" },
          named,
        ),
      ),
    ).toStrictEqual([
      "Kukla Studios",
      "Customer 100051",
      "Credit limit changed to 25,000.00",
    ]);
    expect(
      shown(fromErp("block", "100063", { blocked: true, partnerId: "100063" })),
    ).toStrictEqual(["", "Customer 100063", "Company blocked"]);
    expect(
      shown(
        fromErp(
          "contract",
          "100042",
          { lines: [{}, {}, {}], partnerId: "100042" },
          named,
        ),
      ),
    ).toStrictEqual([
      "Kukla Studios",
      "Customer 100042",
      "3 customer prices updated",
    ]);
    expect(
      shown(
        fromErp("contract", "100042", { lines: [{}], partnerId: "100042" }),
      )[2],
    ).toBe("1 customer price updated");
  });

  test("Then a record without the fields it is shown by falls back to its message", () => {
    expect(recordFields(fromErp("product", "AB1", { sku: "AB1" }))).toBeNull();
    expect(recordFields(fromErp("stock", "AB1", { erpId: "erp" }))).toBeNull();
    expect(recordFields(fromErp("unknown-kind", "AB1", {}))).toBeNull();
  });
});

describe("Given a record the integration made", () => {
  test.each([
    [
      own("order", "300", { erpNumber: "NORT-12" }),
      ["Order 300", "Sales order NORT-12", "Order placed"],
    ],
    [
      own("order", "300", {
        message:
          "order 300: Northwind ERP took its part as sales order 13. order 300: Contoso ERP took its part as sales order 2.",
      }),
      ["Order 300", "Sales orders 13, 2", "Order placed"],
    ],
    [own("order", "300"), ["Order 300", "", "Order placed"]],
    [
      own("changed", "300", {
        message: "Commerce order 300: held on sales order 12",
      }),
      ["Order 300", "Sales order 12", "Order held"],
    ],
    [
      own("shipped", "11", {
        message: "Commerce shipment 11: recorded on sales order 12",
        orderRef: "300",
      }),
      ["Shipment 11", "Sales order 12", "Shipment created"],
    ],
    [
      own("invoiced", "12", { orderRef: "300" }),
      ["Invoice 12", "", "Invoice created"],
    ],
    [
      own("returned", "4", {
        message: "return 4: sent to Northwind ERP as return order 80.",
        orderRef: "300",
      }),
      ["Return 4", "Return order 80", "Return created"],
    ],
    // A save sends the name and the price whatever changed: it is not called a rename.
    [
      own("product-changed", "AB1", {
        message:
          'Product AB1: told Northwind ERP its name ("Cabinet (Admin)") and price.',
      }),
      ["AB1", "", "Product changed"],
    ],
    // Since 2026-10-14 the record names what was sent, and the row says it.
    [
      own("product-changed", "AB1", {
        outcome: "sent",
        sent: ["name", "price", "stock"],
      }),
      ["AB1", "", "Product changed: name, price and stock sent"],
    ],
    [
      own("product-changed", "AB1", { outcome: "failed", sent: undefined }),
      ["AB1", "", "Product changed"],
    ],
    [
      own("product-created", "AB2", {
        outcome: "sent",
        sent: ["name", "price"],
      }),
      ["AB2", "", "Product created: name and price sent"],
    ],
    [
      own("stock-changed", "AB1", {
        stock: [{ name: "Default Source", quantity: 1200 }],
      }),
      ["AB1", "", "Stock changed to 1,200 at Default Source"],
    ],
    [
      own("stock-changed", "AB1", {
        stock: [
          { name: "East", quantity: 4 },
          { name: "West", quantity: 0 },
        ],
      }),
      ["AB1", "", "Stock changed: 4 at East, 0 at West"],
    ],
    [
      own("company-saved", "21", {
        company: { id: 21, name: "Kukla Studios" },
        customers: ["C21"],
      }),
      ["Kukla Studios", "Customer C21", "Company saved"],
    ],
    [
      own("company-saved", "21", { company: { id: 21 } }),
      ["Company 21", "", "Company saved"],
    ],
    [
      { direction: "commerce", kind: "product-deleted", ref: "AB1" },
      ["AB1", "", "Product deleted"],
    ],
  ])("Then it shows both sides and what happened (%#)", (entry, expected) => {
    expect(shown(entry)).toStrictEqual(expected);
  });

  test.each(["21 orders canceled, 3 noted as closed", "no orders to close"])(
    "Then a demo reset says what it closed (%s)",
    (what) => {
      const entry = {
        direction: "reset",
        kind: "reset",
        message: `Demo reset on 2026-09-27: ${what}; the ERPs' changes in Commerce undone. The activity before it was cleared.`,
        ref: "2026-09-27",
      };
      expect(recordFields(entry).details).toBe(`Demo reset: ${what}`);
    },
  );
});

describe("Given a place with no columns", () => {
  test("Then the record reads as one line: what happened, then the record", () => {
    const line = (entry) => recordLine(recordFields(entry));
    expect(line(fromErp("hold", "300", { held: true }))).toBe(
      "Credit hold placed: Order 300",
    );
    expect(line(own("order", "300"))).toBe("Order placed: Order 300");
    expect(line(fromErp("block", "1", { blocked: true, partnerId: "1" }))).toBe(
      "Company blocked: Customer 1",
    );
  });
});
