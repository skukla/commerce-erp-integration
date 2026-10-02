# Partial invoicing: what the pair does, and the customization it leaves open

For the person asked "and if our ERP bills per delivery?". The short answer: the pair
invoices and credits per ERP today, and invoicing per delivery inside one ERP is a
customization of the pair, sketched below. Written 2026-10-02 (AB-26v) from the code and a
live run on Justrite.

## What happens today

| Case | Commerce | Read where |
|---|---|---|
| An order whose lines all belong to one ERP | The ERP invoices the whole order once, after every line has shipped or been closed; Commerce gets one invoice for the whole order | demo-erp `lib/fulfilment.js` `createInvoice` (owner decision 2026-09-23) |
| An order split across two ERPs | Each ERP invoices its own part; Commerce gets one PARTIAL invoice per ERP, of only that ERP's lines. Live 2026-10-02, order 5000000005: invoices 5000000007 (289.86, the Justrite line plus the shipping charge) and 5000000008 (42.42, the Accuform lines), order Complete | `src/router/part-fulfilment.js` `invoicePart` |
| An ERP credits | Commerce gets an offline credit memo of only that ERP's lines; on an order paid on account the refund goes back to the company's credit. One per ERP credit memo, never twice | `src/router/credit-memos.js`; live on orders 5000000003 and 5000000005 |

Two details that matter for the customization:

- **The integration already invoices by quantity.** For each part it records how much of
  each line was invoiced (`part.invoiced`) and, on each ERP invoice, invoices only what of
  the named lines has not been invoiced yet, under the order's lock. Several invoices from
  one ERP against one order would therefore each become a Commerce invoice of their own
  quantities without double billing.
- **There is no invoice-level join.** The ERP's invoice event carries the order, its sales
  order number and the invoiced lines, but no invoice number (contract version 13,
  `be-observer.sales_order_invoice_create`), and the integration keeps no ERP invoice number
  against the Commerce invoice it made. The only join is the order's (`ext_order_id`, and per
  part its `erpNumber`).

Commerce side, as measured: an order paid on account took two partial invoices and two
partial credit memos (orders 5000000003 and 5000000005). Not measured: an order paid through
an online payment gateway, where a capture belongs to an invoice and a later partial capture
depends on the gateway. The order chain endpoints (`POST /V1/orderChain/{orderId}/invoice`)
were named in this item as experimental on the Cloud Service per Adobe's release notes; that
was not re-read for this document.

## The customization: an ERP that bills per delivery

What an ERP like SAP does with delivery-related billing: one invoice per posted delivery.
What the pair would need:

1. **The ERP** invoices per posted shipment instead of once per order, and its invoice event
   names the invoice (`invoiceNumber`) and only that delivery's lines. In the mock ERP that
   is a change to `createInvoice` and the event payload, and a contract version.
2. **An invoice-level join** in the integration: ERP invoice number ↔ Commerce invoice id,
   kept on the part (beside `invoiced`), so a redelivered event is matched by number, not
   only by quantity, and the Admin page can show which Commerce invoice each ERP invoice
   became.
3. **A running open amount per order**: ordered less invoiced less credited, per part, for
   the Admin page and for the payment leg (AB-26s) to clear against.
4. **Credits against a named invoice**: the ERP's credit memo names the invoice it credits;
   the integration refunds against that Commerce invoice (`POST /V1/invoice/{id}/refund` for
   an online capture, `POST /V1/order/{id}/refund` offline, as today).

Where it would live: in the pair, as a change to the adapter's invoice message and the
part record. It needs no sibling integration (routing needed none either: the split lives in
the integration's router).

## What the demo says

One invoice per ERP part, one credit memo per ERP credit, both shown in the walk-through
("One order, two ERPs, from cart to return"). Per-delivery billing inside one ERP is the
customization above, not shown.
