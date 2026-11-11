# Who Closes Demo Orders

Decided by the owner on 2026-11-11, while reviewing Demo Builder's Clear Demo Data window.
This page says what changed, what it means for this repository, and what must change here
before Demo Builder ships it.

## The decision

- **Commerce is the source system, not the ERP.** Demo Builder's Clear Demo Data closes every
  demo order in Commerce itself, by the one reset rule (`src/lib/reset-rule.js` here,
  `src/features/data-installer/services/demoDataWipe/wipeOrders.ts` in demo-builder-vscode).
- **Clear no longer hands orders to this integration.** Until now, Clear asked the integration to
  close the orders of websites it serves, and left them open when the integration was out of date
  or did not answer. That dependency is removed.
- **The ERP is brought in line afterwards, as its own step**, reading Commerce. If that step fails
  it is reported as an ERP problem; it never holds orders open in Commerce.
- **The rules do not depend on one another.** The order rule knows nothing about ERPs; the ERP
  step only reads Commerce.

## The rule changes too, in both copies

Experience League (Commerce Admin guide, "Order status" and "Credit memos") says an order ends in
one of two ways: Canceled, or Closed once "an order was assigned a credit memo and the customer has
received a refund". A credit memo needs an invoice ("you must generate an invoice before creating a
credit memo"), and "you can issue an offline refund … for any payment method".

| Order | Before (the 2026-10-30 rule) | Now |
|---|---|---|
| Shipped but never invoiced | Left open with a note | Invoice what is not invoiced, then refund it all offline: Closed |
| In payment review | Left open with a note | Unchanged: left open with a note. Reported to the SC as "1 order couldn't be closed" with Open Commerce Admin. Rare: it needs the classic PayPal integration with its fraud filter, which Experience League marks "PaaS only" |
| Partly invoiced | Refund the invoiced part; Commerce keeps it open | Invoice the rest first, then refund it all: Closed |

So every demo order ends Canceled or Closed, except one in payment review.

The integration's own reset (`src/lib/close-orders.js`, used when an ERP is removed) applies the
same rule and gets the same change.

## What this repository now does (branch `feature/one-reset-rule`, not merged)

### 1. Every order handler recognises a reset by Commerce's own record

Orders Clear closes carry no mark in this app's State, so the mark alone no longer decides.
`src/lib/reset-closed.js` now treats an order as closed by a reset when either is true:

- this app's own reset marked it in State (`markClosedByReset`, unchanged);
- its Commerce status history carries `RESET_NOTE` ("by the demo reset on").

Clear writes its note BEFORE its first write to an order (Demo Builder commit `6c5f28358` on
`fix/erp-order-close`), so every event it raises already finds the note.

| Handler | Event | How it reads the history |
|---|---|---|
| `order-commerce/created` | order saved | from the event when it carries `status_histories`; it does not today (not in the subscription's fields), so the order is read by number (`GET orders?searchCriteria…increment_id`) |
| `order-commerce/changed` | order saved | the same |
| `order-commerce/invoiced` | invoice saved (Clear's new invoice step raises one) | the order is already read whole (`GET orders/{id}`) for its number; its history is checked too |
| `order-commerce/shipped` | shipment saved | the same |
| `order-commerce/return-saved` | return saved | the same |

A read that fails changes nothing: the event goes on as it did before. The read costs one Commerce
call per order save event that has no mark (an order save that names no order, like the ERP
number clear, reads nothing). Adding `status_histories` to the order save subscription would save
that call; whether Commerce puts the history in that event's payload has not been checked.

### 2. The two copies of the rule agree

`src/lib/reset-rule.js` and `src/lib/close-orders.js` follow the changed rule, in the same order of
writes per order as Demo Builder's `wipeOrders.ts` and `wipeOrderRun.ts`:

1. the reset note FIRST, decided from the plan (`leadingNoteOf`), unless a stopped run already
   wrote a reset note. Cancel: "Canceled by the demo reset on <day>.". Invoice and refund:
   "Refunded and closed by the demo reset on <day>.". Payment review, or nothing left to invoice
   or refund: "The ERP documents for this order were removed by the demo reset on <day>." (this
   repo's left-open note; Demo Builder's own left-open note has other words);
2. the integration forgets it: its parts record, and its ERP number;
3. its open returns closed;
4. off hold, if held;
5. canceled; or invoiced for whatever is not yet invoiced (`POST order/{orderId}/invoice`,
   `{ capture: false, notify: false }`, new client call `invoiceRemainder`), read again, and
   everything invoiced refunded offline (`POST order/{orderId}/refund`);
6. ONE correcting note only when Commerce's answer differs: a cancel not answered `true` gets the
   left-open note; a refund after which the order does not read Closed gets "Refunded the invoiced
   items by the demo reset on <day>.".

Run again, an order is done when it is Canceled or Closed or carries the left-open note. One with
another reset note but not finished is processed again without a second leading note. This app's
State mark is still written before the first write, as before.

The shared example table `test/lib/reset-rule-orders.js` matches Demo Builder's
`tests/helpers/resetRuleOrders.ts` case for case. Its header says the two must stay identical.

A return Commerce keeps open stops that order in both copies: it is reported, and the next run
finishes it.

Where the two copies still differ: an already Canceled or Closed order. Here its parts record and
ERP number are still forgotten, as before (this app's own records, not Commerce); Demo Builder
writes nothing to it.

### 3. Proven on a live store (2026-11-11)

On Demo Builder's test store, with this app at `d17e9f7` deployed: an order shipped but never
invoiced and one with half its items invoiced both reached the ERP; Demo Builder's Clear then
invoiced the rest and refunded each in full, so both read Closed, each with its reset note written
first; both sales orders were removed from the ERP; no handler failure was recorded after Clear
started; a second Clear wrote nothing. `POST order/{id}/invoice` with `{ capture: false, notify:
false }` and no items invoices every remaining line.

## Where this rule stands

The one reset rule is on `main` (`d17e9f7`).
