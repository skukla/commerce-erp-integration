/*
 * The confirmation's order comment. With several ERPs both confirm the same order, often with
 * the same sales order number (each ERP numbers its own), so the comment names the ERP: on
 * Justrite on 2026-10-02 order 5000000006 carried "Order confirmed in the ERP (ERP sales
 * order 0000001004)" twice, one per ERP, with nothing to tell them apart.
 */
import { transformData } from "#src/order/external/updated/transformer";

const params = { data: { erpNumber: "0000001004", status: "confirmed" } };

test("With the ERP's name, the comment names it", () => {
  expect(transformData(params, "Accuform ERP").statusHistory.comment).toBe(
    "Order confirmed in Accuform ERP (ERP sales order 0000001004)",
  );
});

test("Without a name (one ERP), the comment reads as it always has", () => {
  expect(transformData(params).statusHistory.comment).toBe(
    "Order confirmed in the ERP (ERP sales order 0000001004)",
  );
});
