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

| Order | Today (step 5 of `reset-rule.js`) | Now |
|---|---|---|
| Shipped but never invoiced | Left open with a note | Invoice what is not invoiced, then refund it all offline: Closed |
| In payment review | Left open with a note | Unchanged: left open with a note. Reported to the SC as "1 order couldn't be closed" with Open Commerce Admin. Rare: it needs the classic PayPal integration with its fraud filter, which Experience League marks "PaaS only" |
| Partly invoiced | Refund the invoiced part; Commerce keeps it open | Invoice the rest first, then refund it all: Closed |

So every demo order ends Canceled or Closed, except one in payment review.

The integration's own reset (`src/lib/close-orders.js`, used when an ERP is removed) applies the
same rule and gets the same change.

## What must change here before Demo Builder ships it

### 1. Orders Clear closes are not marked in this app's State

Every handler of an order event skips an order only when `closedByReset` finds this app's mark
(`src/lib/reset-closed.js`, set by `markClosedByReset` in `src/lib/order-parts.js` before the
integration's own reset writes). Clear writes to Commerce directly, so its orders carry no mark.

`reset-closed.js` says what happens then: "without the mark a refunded order with no ERP number and
no parts record reads as a new order never sent". The order saved, invoice saved and return saved
events that Clear's cancels, invoices, refunds and notes raise could send those orders to an ERP.
The new invoice-first step adds an invoice save event this app subscribes to
(`order-commerce/invoiced`).

Options, in the order recommended:

| Option | How | Cost |
|---|---|---|
| **Recognise the reset by Commerce's own record** | Handlers also treat an order whose history carries `RESET_NOTE` ("by the demo reset on") as closed. Clear then writes its note BEFORE its first write to an order (today it notes last), so every event it raises already sees it | Keeps Commerce the source and adds no dependency. Costs one order read per event that lacks the mark |
| Clear marks the orders here first | Demo Builder calls this app to mark each order, then closes it | Brings back the dependency the decision removed |
| Skip events for websites being cleared | A flag per website for the length of a clear | A second source of truth; fails if Clear stops halfway |

### 2. The two copies of the rule must agree

The rule is copied line for line because an App Builder app cannot import Demo Builder's code. Keep
the copies one with a shared table of order states and the expected result (canceled, invoiced and
refunded, left open), run by the tests in both repositories. Move the rule to a shared package only
if it keeps changing.

### 3. Prove it on a live store first

On the test store, with the owner's go: an order shipped but never invoiced ends Closed after
invoice and refund; a partly invoiced one ends Closed; none of Clear's writes sends anything to an
ERP; a second Clear changes nothing.

## Where this rule stands

The one reset rule lives on `feature/one-reset-rule` and is not merged to `main` yet.
