# Walk-through: what to look at in the ERP, what to look at in Commerce, and how each relates

For the person giving the demo. Three parts: the ERP screen by screen along the twenty-minute
path, Commerce screen by screen from the other side, and one table per business concept
saying which screen on each side holds it and what joins them. The integration's Admin page
(Mapping tab) is the live version of those tables; this is the printable one.

Every ERP screen below is named by its address in the ERP's own preview
(`npm run preview` in the `demo-erp` repository, then `#…` in the address bar), so each
look is reproducible with the stand-in records. Against a deployed pair the same addresses
open the same screens with real records. Written 2026-09-24 from the code and the preview;
re-check against a deployed pair before a first showing.

Two words used throughout: **mirrored** means the value came from Commerce and every sync
overwrites it; **the ERP's own** means the ERP decides it and Commerce follows, or never
hears of it.

---

## Part 1: the ERP, screen by screen

### 1. Home (`#home`)

A back office with work in it. Eight cues, each a count of documents on which a move is
open right now: orders to confirm, on credit hold, to ship, to invoice; shipments to post;
blocked customers; events not delivered and pending. Click a cue and the list opens filtered
to exactly those rows; the rail shows the same numbers. Below: the open order value and
the five most recently touched documents.

What is the ERP's own: everything here. The cues are counted from the documents, never
stored, so they cannot disagree with the lists they open.

What to say: this is the ERP user's morning. Nothing on it is a database count.

### 2. Products, and one product (`#products`, then a row, or `#products?open=P000005`)

The list: SKU, description, type (a simple product, or a configurable one with its
variants), base unit, list price, **On hand**, **Available**, and a status that reads
Blocked for sales, Low stock, In stock or Out of stock.

The product page: Details (name, the locked SKU), Pricing (list price; a link to its
contract prices, or the sentence that none names it), Basic data (base unit, product type
in ERP words, and the **Blocked for sales** switch), Open orders (every order holding
this product's stock, with the open quantity), Inventory (each warehouse with its on-hand
figure, and the line On hand · Committed · Available).

Mirrored: SKU, name, type, variants, list price, the warehouses and their quantities (a
warehouse is a Commerce inventory source). The ERP's own: base unit, sales status,
committed and available (worked out from the open orders on every read), the warehouse's
ERP name.

What to say: block the product for sales and every shipment of it is refused, in words,
until it is sellable again. Commerce is not told; that is the ERP's decision.

### 3. Customers, and one customer (`#partners`, then a row, or `#partners?open=C000102`)

The list: customer, name, sales organisations, payment terms, credit limit, **Exposure**,
**Available**, blocking. The walk-in account (P000000) has no credit relationship and
shows dashes.

The customer document: identity (customer, name, partner type Sold-to, the Commerce
company id, customer group, email domain, the sales organisations it is Sold-to in,
payment terms, website), Legal identity (legal name, VAT / tax id, reseller id, legal
address), Credit (limit, exposure, available, credit status, blocking, orders on credit
hold, and a meter of how much of the limit is used), Open items (the uninvoiced orders the
exposure is made of, adding up to it; switch to History for every order), Pricing (the
rules agreed with this customer).

Mirrored: the company's name and id, customer group, legal identity, the website its admin
belongs to, the credit limit (from company credit), whether it is blocked (Commerce's
boolean arrives as the ERP's "blocked for all business"). The ERP's own: payment terms,
the four blocking levels, exposure and available (never stored), the sales-organisation
memberships (widened by every order the customer places).

What to say: a credit limit with nothing beside it says nothing. Exposure is what this
customer still owes for; the list under it is that figure.

### 4. Pricing conditions (`#pricing`)

The rules: contract prices, contract discounts, discount ceilings, each with customer,
product, sales organisation scope, amount, minimum quantity, validity and a status (active,
scheduled, expired). Add one with **Add rule**. Then **Test a Price**: pick a customer and
a product, a quantity and a date, and the ERP answers what it would charge and, for every
rule that did NOT apply, why (not yet valid, below the minimum quantity, a more specific
rule won, the wrong sales organisation).

The ERP's own: every condition. Commerce never stores them; the cart asks the ERP at cart
time (part 2, the cart).

What to say: add a contract price for the customer from step 3 on the product from step 2,
valid from today, minimum quantity 10. Test at quantity 4: it does not apply, and the ERP
says why. Test at 10: it does.

### 5. Sales orders, and one order (`#orders`, then a row, or `#orders?open=0000001003`)

The list: sales order, order date, reference (the Commerce order number), sold-to,
**Shipping** (not, partly, fully shipped), **Billing** (not invoiced, invoiced, credited),
net amount, status. Two filters: what work is open (the cues) and the stage (open, in
process, completed, cancelled).

The order document, the screen that carries the demo: a header of labelled fields
(document type, order date, the customer reference, sold-to and ship-to, sales
organisation, payment terms, currency, overall status, shipping status, billing status,
credit status), numbered lines with order, shipped and open quantities (a SKU opens the
product), the money (net, tax, total), Related documents (the shipments and the invoice as
boxes that open), and the Timeline (everything that happened to it, when, with the
documents linked). The actions the ERP allows sit on the title line: Confirm, Create
shipment, Create invoice, Cancel order; on a held order, Release and Reject.

Mirrored: the order itself as placed (lines, quantities, prices, the buyer, the currency,
the Commerce order number, the sales organisation of the website it came through). The
ERP's own: its number, confirmation, every shipment and the invoice, the credit decision,
the status words, the timeline.

What to say: confirm it. Create a shipment for part of line 10 and post it; the strip grows
a shipment and Shipping reads Partly shipped. Ship the rest; a second shipment, a second
number, Fully shipped. Create the invoice; Billing reads Invoiced. Each step is a line on
the timeline.

### 6. Shipments and Invoices (`#shipments`, `#invoices`, and a row of each)

Shipments: number, date, sales order, sold-to, ship-from (the ERP's own plant name),
quantity, status (open until posted). The shipment document: header, ship-from, lines.
Invoices: number, billing date, sales order, sold-to, total, status. The invoice
document: header (billing date, bill-to, payment terms, **due date**, currency), the
Seller (this ERP as the company code, the sales organisation, the country), lines, totals.

The ERP's own: both documents, their numbers, the due date. Mirrored: nothing on them,
except the seller's currency and country, which come from the website mapped to the
company code.

### 7. A held order (`#orders?open=0000001007`)

An order that arrived over the customer's limit, or from a blocked customer, is created
and HELD, not refused. The header says On credit hold with the reason; Confirm is not
offered; Release and Reject are. Release lets it proceed; Reject cancels it with the
reason Credit rejected, which Commerce hears.

What to say: raise exposure past the limit or block the customer, place a second order in
the storefront, and watch it arrive held.

### 8. Event Journal (`#events`)

Every change the ERP published (price, stock, credit limit, block, order confirmed,
shipment posted, invoice created, cancelled, credit hold) and every change that arrived
from Commerce (imports, a Commerce-side shipment, invoice, cancellation or hold), as
sentences naming the documents, each a link. Delivered, pending or failed, with Retry and
Requeue. The detail page carries the wire name and the event id Debug Tracing lists.

### 9. Settings (`#settings`)

Name; Records (Sync records, Wipe all records, and what the last wipe removed);
Document numbering (each range's next number, and the currency money falls back to);
Organisation (the company code with its currency and country; each sales organisation
with its website and its customer and order counts); Warehouses (each plant with its ERP
name, its Commerce source code and name, its product count; click to rename); Appearance.

The ERP's own: the name, the warehouse names, the look. Derived from Commerce on every
sync: the organisation card. Nothing here survives a wipe except the settings themselves,
and a counter never rewinds, so no document number is ever handed out twice.

---

## Part 2: Commerce, screen by screen

The same story from the other side. Each screen names the ERP action that put something
there.

### The storefront: cart and checkout

The buyer signs in as a user of the company from step 3. At quantity 4 the cart shows the
list price; at 10, the contract price from step 4. Nothing was deployed between the two:
the cart asks the ERP for the buyer's price on every totals calculation (the two
totals-collector webhooks: contract price, discount ceiling). Placing the order fires the
order event; within seconds the ERP holds a sales order with its own number.

### Sales → Orders → the order

`ext_order_id` (shown as the External Order Id in the order view) is the ERP's number with
this pair's prefix, written back when the ERP took the order. The comments carry every ERP
move in words: the number, the confirmation, each shipment, the invoice, a hold or a
release, a cancellation with its reason. The status follows the ERP: Processing when the
ERP confirms (a setting on the Mapping tab's Order card), Complete once Commerce sees it
shipped and invoiced (Commerce's own rule), Canceled when the ERP cancels, On Hold while
the ERP holds it for credit.

### Sales → Shipments, Sales → Invoices

Each ERP shipment posted is a Commerce shipment against the same order, for the same items
and quantities, from the same inventory source the ERP shipped from. The ERP's invoice is a
Commerce invoice for the whole order, captured. A shipment or invoice made here first
reaches the ERP as a Commerce-side move and is not echoed back.

### Catalog → Products → the product

Name and price follow an ERP edit within the minute; stock per inventory source follows an
ERP stock edit. A change made here (price, name, stock) reaches the ERP and overwrites its
copy: Commerce is the master the demo is prepared in. Stores → Inventory → Sources lists
the warehouses the ERP knows.

### Customers → Companies → the company

The credit limit follows the ERP's; Status reads Blocked when the ERP blocks the customer
at any level (shipping, invoicing or all business: Commerce has one boolean) and Active
again when the ERP opens it. A change made here reaches the ERP within
the minute. The company's admin user's website is the website whose sales organisation the
ERP's customer is Sold-to in.

### System → the ERP's name: the integration's Admin page

**Mapping**: one card per business concept the two systems share, Commerce's records on
the left, the ERP's on the right, the arrow saying which side owns each piece, the join in
a sentence with the setting that makes it editable on the card (the sales organisation per
website, the order-number prefix, which products belong to this ERP), the card's other
switches, the ERP's live figures, and what has crossed for that card in each direction.
The Buying organization and Sellable item cards look up one company id or SKU as both
systems hold it.

**Status & sync**: whether the ERP is reachable, its counts, Refresh partners, Sync records,
Reset (undoes every write the integration made onto Commerce and rebuilds the ERP from
Commerce), Follow an order (one order's whole life across both systems and the integration
between them), and What crossed (every order sent and every ERP event applied, with Retry
on anything that did not get through).

---

## Part 3: how each relates

One table per business concept. "Owner" is which side decides the field; the other follows.

### Buying organization

| ERP (Customers → the customer) | Commerce (Customers → Companies → the company) | Owner |
|---|---|---|
| Business partner (sold-to): id, name | Company: id, name | Commerce; the join is the Commerce company id |
| Customer group id | Customer group · shared catalog | Commerce |
| Blocking level (open · shipping · invoicing · all) | Status (active / blocked) | Both: Commerce's boolean is the master on import; the ERP's level writes back as the boolean |
| Legal identity (legal name, VAT / tax id, reseller id, address) | The company's legal fields | Commerce |
| Payment terms | — | ERP |
| Sales organisations it is Sold-to in | The company admin's website | Derived: the website's sales organisation setting |

### Selling organization

| ERP (Settings → Organisation) | Commerce (Stores → All Stores; the Mapping tab) | Owner |
|---|---|---|
| Sales organisation (code, name) | Website | Both: the per-website setting on the Mapping tab is the join |
| Company code currency, country | Base currency and locale (store configuration) | Commerce |
| Seller identity on the invoice | Store Information (address, VAT) | Commerce; not readable over REST, so blank on the ERP |
| Company code 1000 | — | ERP |

### Sellable item

| ERP (Products → the product) | Commerce (Catalog → Products → the product) | Owner |
|---|---|---|
| Product: SKU, name, type, variants | Product: SKU, name, type, configurable parent and variants | Commerce; the join is the SKU |
| List price | Price | Both: imports from Commerce; an ERP edit writes back |
| Base unit | — | ERP |
| Sales status (sellable / blocked for sales) | — | ERP; Commerce is not told |

### Price

| ERP (Pricing) | Commerce (the cart; the Mapping tab's Price card) | Owner |
|---|---|---|
| Contract price · contract discount · discount ceiling, with validity, minimum quantity, sales organisation | The cart's line price and discount (totals-collector webhooks, at cart time) | ERP quotes; Commerce applies; the two switches on the Price card turn each webhook on or off per website |
| — | Shared-catalog custom price, website price | Commerce; the ERP's quote replaces the line price only where a contract price applies |

### Inventory position

| ERP (the product's Inventory card) | Commerce (Stores → Inventory; the product's Sources) | Owner |
|---|---|---|
| Warehouse on hand | Source item quantity | Both: last writer wins in either direction; the ERP's writes are ledgered for reversal |
| Committed to open orders · available | — | ERP, never stored |
| — | Stock per website, salable quantity | Commerce |

### Credit

| ERP (the customer's Credit card) | Commerce (the company's Credit tab) | Owner |
|---|---|---|
| Credit limit | Credit limit | Both: imports from Commerce; written back from the ERP, ledgered |
| Exposure · available · held orders · the credit decision | — | ERP |
| — | Credit balance (payment on account) · history | Commerce; a separate figure from exposure, not compared |

### Order (order to cash)

| ERP (Sales orders → the order; Shipments; Invoices) | Commerce (Sales → Orders, Shipments, Invoices) | Owner |
|---|---|---|
| Sales order, lines, sold-to | The order, items, buyer | Commerce; the join is `ext_order_id`, the ERP number with the pair's prefix |
| Confirmation · status · notes | Order status · comments | ERP |
| Shipments (posted) | Shipments | Both: made in either system, mirrored once, never echoed |
| Invoice | Invoice | Both |
| Credit hold | Hold | Both: an ERP hold puts the order On Hold; a Commerce hold holds the ERP order |
| Cancellation (with its reason) | Cancellation | Both |
| — | Credit memo | Commerce; not mirrored yet |

### Payment / receivable

Not connected yet: order to cash's payment leg is the next slice. The ERP will hold an open
item per invoice, incoming payments and clearing; Commerce holds the invoice's capture and,
for orders paid on account, the company's credit balance.

### Fulfilment source

| ERP (Settings → Warehouses; a shipment's ship-from) | Commerce (Stores → Inventory → Sources; a shipment's source) | Owner |
|---|---|---|
| Warehouse: code, the ERP's own name | Inventory source: code, name | Both: Commerce keeps its name; the ERP's name is set on its Settings and survives a wipe; the join is the source code |
| Which ERP owns the products it ships | The ownership rule on the Mapping tab's Fulfilment source card | The setting, per pair |

---

## Two ERPs on one store

The direction (owner, 2026-09-24): ONE integration serving several ERPs, the way the customer
would build it. Each ERP is a configured target inside the same integration (its own address,
name, order-number prefix and ownership rule); the routing consumer is part of the integration
and passes orders straight through when there is one target. The mock ERPs stay separate
systems, each with its own screen and look. Once a second target exists, the same walk-through
holds per ERP: each shows only the products it owns, each Commerce order carries the number
of the ERP that took it in its own order attribute, and the Mapping tab says which products
belong to which ERP. Today's build serves one target; that single-ERP skeleton is what the
target list grows out of. The nine moments of a split order (one order,
lines owned by two ERPs) belong to the routing integration and are written when it exists.

The pattern behind it, in the words to give a customer: an order placed in Commerce is
consumed ONCE, by the integration's routing consumer action; it decides which ERP owns each
line (the product's owning-system attribute), splits the order into parts, and hands each
part to that ERP pair's own runtime actions, which raise that pair's own events towards its
ERP. The pairs stop listening to Commerce for new orders and know nothing of one another,
so adding an ERP is adding a pair and a rule, and the split logic sits in one replaceable
place. Each pair writes its number into its own custom order attribute on the Commerce order.

## What this walk-through has not proved live

Written from the code and the preview on 2026-09-24. Before a first showing, walk it once
against a deployed pair and correct here anything that reads differently, in particular:
the Commerce order view's label for `ext_order_id`, the exact status words Commerce shows
after each ERP move, and the Admin page rendered by a real Commerce Admin.
