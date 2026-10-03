# Walk-through: what to look at in the ERP, what to look at in Commerce, and how each relates

For the person giving the demo. Three parts: the ERP screen by screen along the twenty-minute
path, Commerce screen by screen from the other side, and one table per business concept
saying which screen on each side holds it and what joins them. The integration's Admin page
will carry a live version of those tables (the Mapping view, planned as AB-26m); until then
this printable one is the only one.

Every ERP screen below is named by its address in the ERP's own preview
(`npm run preview` in the `demo-erp` repository, then `#…` in the address bar), so each
look is reproducible with the stand-in records. Against a deployed pair the same addresses
open the same screens with real records. Written 2026-09-24 from the code and the preview;
the Event Journal, Settings and the order-to-return journey were brought up to date and run
against the deployed Justrite pair on 2026-10-02.

Two words used throughout: **mirrored** means the value came from Commerce and every fill or
Commerce event overwrites it; **the ERP's own** means the ERP decides it and Commerce follows, or never
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

The list: customer, name, sales organizations, payment terms, credit limit, **Exposure**,
**Available**, credit block. The walk-in account (P000000) has no credit relationship and
shows dashes.

The customer document: identity (customer, name, partner type Sold-to, the sales
organizations it is Sold-to in, payment terms), Legal identity (legal name, VAT / tax id, reseller id, legal
address), Credit (limit, exposure, available, credit status, **Credit block**, **Website
account**, orders on credit hold, and a meter of how much of the limit is used), Open items (the uninvoiced orders the
exposure is made of, adding up to it; switch to History for every order), Pricing (the
rules agreed with this customer).

Filled by Demo Builder: the company's name, legal identity, the credit limit (from company credit), and the
**Website account** (Active or Closed: "Set in Commerce. Closed stops all website orders."), a
read-only copy of the company's Active/Blocked switch in Commerce. The ERP's own: payment terms,
the **Credit block** (None, Stop shipping, Stop invoicing, Stop all: "Set here. Stops this ERP's
orders only."), which nothing from Commerce ever changes, exposure and available (never stored),
the sales-organization
memberships (widened by every order the customer places). The ERP holds no Commerce id: which
Commerce company a customer is lives in the integration's key map.

What to say: a credit limit with nothing beside it says nothing. Exposure is what this
customer still owes for; the list under it is that figure.

### 4. Pricing conditions (`#pricing`)

The rules: contract prices, contract discounts, discount ceilings, each with customer,
product, sales organization scope, amount, minimum quantity, validity and a status (active,
scheduled, expired). Add one with **Add rule**. Then **Test a Price**: pick a customer and
a product, a quantity and a date, and the ERP answers what it would charge and, for every
rule that did NOT apply, why (not yet valid, below the minimum quantity, a more specific
rule won, the wrong sales organization).

The ERP's own: every condition. Commerce holds only what is in force for each customer: the
integration writes it into the company's shared catalog as tier prices, and no ERP is asked
at cart time (part 2, the cart; AB-26z).

What to say: add a contract price for the customer from step 3 on the product from step 2,
valid from today, minimum quantity 10. Test at quantity 4: it does not apply, and the ERP
says why. Test at 10: it does.

### 5. Sales orders, and one order (`#orders`, then a row, or `#orders?open=0000001003`)

The list: sales order, order date, reference (the Commerce order number), sold-to,
**Shipping** (not, partly, fully shipped), **Billing** (not invoiced, invoiced, credited),
net amount, status. Two filters: what work is open (the cues) and the stage (open, in
process, completed, canceled).

The order document, the screen that carries the demo: a header of labeled fields
(document type, order date, the customer reference, sold-to and ship-to, sales
organization, payment terms, currency, overall status, shipping status, billing status,
credit status), numbered lines with order, shipped and open quantities (a SKU opens the
product), the money (net, tax, total), Related documents (the shipments and the invoice as
boxes that open), and the Timeline (everything that happened to it, when, with the
documents linked). The actions the ERP allows sit on the title line: Confirm, Create
shipment, Create invoice, Cancel order; on a held order, Release and Reject.

Mirrored: the order itself as placed (lines, quantities, prices, the buyer, the currency,
the Commerce order number, the sales organization of the website it came through). The
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
Seller (this ERP as the company code, the sales organization, the country), lines, totals.

The ERP's own: both documents, their numbers, the due date. Mirrored: nothing on them,
except the seller's currency and country, which come from the website mapped to the
company code.

### 7. A held order (`#orders?open=0000001007`)

An order that arrived over the customer's limit is created and HELD, not refused. (An
order from a customer on the ERP's credit block never reaches the ERP: it waits On Hold in Commerce, with
the reason in its history, and is sent when the ERP opens the customer again.) The header says On credit hold with the reason; Confirm is not
offered; Release and Reject are. Release lets it proceed; Reject cancels it with the
reason Credit rejected, which Commerce hears.

What to say: raise exposure past the limit, place a second order in the storefront, and
watch it arrive held. Or set the customer's credit block: the company stays active in Commerce, its open
orders go On Hold, and the next order waits there until you open the customer again.

### 8. Event Journal (`#events`)

Every change the ERP published, in the ERP's own words, and every change that arrived from
the web shop (imports, a shipment or invoice made there, a cancellation or hold), as sentences
naming the documents, each a link. Sent, pending or failed, with Retry and Requeue.

The ERP knows nothing about Commerce: it publishes its own events and the integration
translates each into what Commerce needs (one module, `actions/ingestion/translate.js`). What
the journal says, and the event behind it on the detail page:

| The journal says | The ERP's event |
|---|---|
| Sales order changed (confirmed, held, released, canceled) | `SalesOrder.Changed` |
| Goods issue posted | `OutboundDelivery.GoodsIssueStatusChanged` |
| Billing document created (invoice), or (credit memo) | `BillingDocument.Created` |
| Customer return changed | `CustomerReturn.Changed` |
| Incoming payment posted | `IncomingPayment.Posted` |
| Product changed: name, list price (the fields that changed) | `Product.Changed` |
| Product stock changed | `ProductStock.Changed` |
| Customer changed: credit limit, blocking level | `Customer.Changed` |
| Price list changed | `PriceList.Changed` |

The ERP keeps the web shop's numbers as references on its own documents (the order's customer
reference is the Commerce order number), never as Commerce ids.

What to say: this is what an ERP sends. The names and fields are the ERP's; nothing in it was
shaped for Commerce. The integration is where the translating happens, and it is the part a
customer would write for their own ERP.

### 9. Settings (`#settings`)

A setup form, in four sections an ERP user edits. Each field changes what the ERP does or
prints.

- **Company**: name, company code, address, tax ID, currency. Printed as the Seller on every
  invoice.
- **Sales & Receivables**: default payment terms (new customers get them, and they set invoice
  due dates); credit warnings (credit limit, overdue balance, both or none: what holds a new
  order); the return reasons and the default one (a return order's lines carry the code).
- **Number Series**: one row per document type with its starting, next and ending number. Click
  a next number to change it; it only moves forward, so no number is handed out twice.
- **Sales Organizations**: code, name, currency and the website each serves, with Add and Edit.

What to say: change the credit warnings to "overdue balance" and an order from a customer with
an unpaid, overdue invoice arrives held, with that reason.

### 10. Appearance (the person icon, top right)

How this ERP's screen looks: a theme in one click, or the colour, logo and navigation (side
rail or top band) on their own. Each pick repaints the screen at once; Save keeps it, Cancel
puts back what was there. It is for the person preparing the demo, so two ERPs side by side
look different; it is not on the Settings page, and it changes no record.

Wiping and refilling an ERP, and pretending one is down, are not on the ERP's screen: they are
Demo Builder's (Reset ERPs on the integration's card, Simulate downtime on each ERP's card).

---

## Part 2: Commerce, screen by screen

The same story from the other side. Each screen names the ERP action that put something
there.

### The storefront: cart and checkout

The buyer signs in as a user of the company from step 3. At quantity 4 the cart shows the
list price; at 10, the contract price from step 4. The price is Commerce's own: the
integration wrote the ERP's contract price into the company's shared catalog as a tier price
at the line's minimum quantity, so the listing and the product page show it
too, and no ERP is asked while the buyer shops. Placing the order fires the
order event; within seconds the ERP holds a sales order with its own number.

### Sales → Orders → the order

`ext_order_id` (shown as the External Order Id in the order view) is the ERP's number with
this pair's prefix, written back when the ERP took the order. The comments carry every ERP
move in words: the number, the confirmation, each shipment, the invoice, a hold or a
release, a cancellation with its reason. The status follows the ERP: Processing when the
ERP confirms (a setting in the Admin page's Settings section), Complete once Commerce sees it
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

The credit limit follows the ERP's. Status stays Active when the ERP sets its credit block:
the company's Active/Blocked switch is the website account, set only here and copied to each
ERP read-only ("Closed" there). The ERP's credit block holds that ERP's
orders of the company instead (On Hold, the reason in each order's history), and its next
orders wait; when the ERP opens the customer again they are released and sent. A change made here reaches the ERP at once,
by the company save event. The company's admin user's website is the website whose sales organization the
ERP's customer is Sold-to in.

### Apps → the integration's name → Integration: the integration's Admin page

Three sections. **Overview**: whether the ERP answers, what it holds, and one company id or
SKU looked up as both systems hold it. **Activity**: what crossed each way (every order sent
and every ERP event applied, the ERP's price events included), with Retry on anything that
did not get through, and one order followed across both systems. **Settings**: the settings
per scope (the sales organization per website, the order-number prefix, which products belong
to this ERP) and, with several ERPs, per ERP. The Mapping view, one card per business concept,
is planned (AB-26m). Filling and resetting the ERP live in Demo Builder (its Load demo data
and Reset records); this page has no buttons for them.

---

## Part 3: how each relates

One table per business concept. "Owner" is which side decides the field; the other follows.

### Buying organization

| ERP (Customers → the customer) | Commerce (Customers → Companies → the company) | Owner |
|---|---|---|
| Customer (sold-to): its own number, name | Company: id, name | Commerce; the join is the integration's key map (ERP customer number = Commerce company). The ERP holds no Commerce id |
| Credit block (None · Stop shipping · Stop invoicing · Stop all) | — | ERP only; Commerce never changes it. It holds that ERP's orders, never the company |
| Website account (Active · Closed) | Status (active / blocked) | Commerce; copied to the ERP read-only. Closed stops all website orders |
| Legal identity (legal name, VAT / tax id, reseller id, address) | The company's legal fields | Commerce |
| Payment terms | — | ERP |
| Sales organizations it is Sold-to in | The company admin's website | Derived: the website's sales organization setting |

### Selling organization

| ERP (Settings → Company, Sales Organizations) | Commerce (Stores → All Stores; the Admin page's Settings) | Owner |
|---|---|---|
| Sales organization (code, name, currency, the website it serves) | Website | ERP: its own table, seeded by the first fill and never overwritten after; the per-website setting in the Admin page's Settings is the join |
| Company: name, code, address, tax ID, currency | Store Information, base currency | ERP: set on its Settings; a field never set falls back to the home website's |
| Seller identity on the invoice | — | ERP: its Company and the order's sales organization |

### Sellable item

| ERP (Products → the product) | Commerce (Catalog → Products → the product) | Owner |
|---|---|---|
| Product: SKU, name, type, variants | Product: SKU, name, type, configurable parent and variants | Commerce; the join is the SKU |
| List price | Price | Both: imports from Commerce; an ERP edit writes back |
| Base unit | — | ERP |
| Sales status (sellable / blocked for sales) | — | ERP; Commerce is not told |

### Price

| ERP (Pricing) | Commerce (the company's shared catalog, where the integration publishes them; each ERP price event in the Admin page's Activity) | Owner |
|---|---|---|
| Contract price · contract discount, in force today, with minimum quantity | Tier price for the company's shared-catalog customer group: fixed, or a percentage, at the minimum quantity, all websites | ERP; the integration writes what is in force and takes back what is not (ledgered, undone by detach) |
| Discount ceiling | — | ERP; it caps only the ERP's own prices (the prices in force it publishes), and is not checked on an order |
| — | Other shared-catalog custom prices, website price | Commerce |

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
| Credit memo (against the invoice, or a return's) | Credit memo, offline, refunded to company credit on an order paid on account | ERP: each ERP credits only its own lines, once per ERP credit memo |
| Return order (open · received · credited) | Return (Pending → Authorized → Received → Processed and Closed) | Commerce takes the request; each ERP takes its lines, receives and credits them |
| Incoming payment against an invoice (open item: open · partly paid · paid) | On an order paid on account, the company's credit given back (Reimbursed in its credit history); a staff comment on the order either way | ERP: each payment crosses once, per ERP; a reset takes the credit back |

One invoice per ERP part and one credit memo per ERP credit. An ERP that bills per delivery is
a customization of the pair: `docs/partial-invoicing.md`.

### Payment / receivable

Payments now cross from the ERP (AB-26s, contract version 14). The ERP holds an open item per
invoice and the incoming payments that clear it, partial ones included; Commerce holds no
receivable. When the ERP posts a payment, the integration writes on the order a staff comment
"Paid in <ERP> (payment <number>)", and, when the order was paid on account, gives the company
that amount back on its credit: Customers → Companies → the company, Company Credit, where the
history row reads Reimbursed with the payment number as its purchase order. An order paid any
other way (check / money order) changes no credit. Each ERP payment is applied once however
often its event is delivered, and with two ERPs each pays back only its own invoice. The
reimbursement is ledgered, so a demo reset takes it back. Post one from the ERP's invoice
(`#invoices`, the invoice, **Post payment**); the Payments list (`#payments`) shows them all.

### Fulfilment source

| ERP (Warehouses; a shipment's ship-from) | Commerce (Stores → Inventory → Sources; a shipment's source) | Owner |
|---|---|---|
| Warehouse: code, the ERP's own name | Inventory source: code, name | Both: Commerce keeps its name; the ERP's name is set on its Warehouses page and survives a wipe; the join is the source code |
| Which ERP owns the products it ships | The ownership rule in the Admin page's Settings | The setting, per pair |

---

## Two ERPs on one store

The direction (owner, 2026-09-24): ONE integration serving several ERPs, the way the customer
would build it. Each ERP is a configured target inside the same integration (its own address,
name, order-number prefix and ownership rule); the routing consumer is part of the integration
and passes orders straight through when there is one target. The mock ERPs stay separate
systems, each with its own screen and look. Once a second target exists, the same walk-through
holds per ERP: each shows only the products it owns, each Commerce order carries the number
of the ERP that took it in its own order attribute, and the ownership setting says which products
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

## The order's steps in the ERP, and what Commerce shows for each

The ERP has more steps than Commerce and names them its own way. One page to keep beside you:

| In the ERP (the button) | What it means there | Commerce shows |
|---|---|---|
| The order arrives | A sales order is created, with the ERP's own number | The order, Pending, with a note naming that number |
| **Release** or **Reject** (only on a credit hold) | Credit approves the order, or turns it down | The hold comes off, or the order is canceled |
| **Confirm** | The ERP accepts the order | Processing, with a note |
| **Create shipment** | A delivery is prepared; nothing has left the warehouse | Nothing yet |
| **Post** (on the shipment) | Goods issue: the goods leave the warehouse | A shipment, then an invoice, for this ERP's lines |
| **Post payment** (on the invoice) | Money received against the invoice | A "Paid in …" note; on an order paid on account, the company's credit given back |
| **Receive** (on a return order) | The returned goods are back in the warehouse | The return reads Received |
| **Post credit memo** (on the return order or the invoice) | The customer is credited | A credit memo for this ERP's lines; the return closes when every ERP has credited |

With two ERPs each does its own steps for its own lines; Commerce's order reads Complete only
when every ERP has shipped and invoiced its part.

## One order, two ERPs, from cart to return (proved live on Justrite, 2026-10-02)

The journey the order-to-return loop built and ran end to end (order 5000000005: placed,
split, shipped, invoiced, returned and credited in under two minutes, every step below
observed). Before a showing: the store's setup guide is done, both ERPs are filled ("Fill
from Commerce" on the integration card), and a buyer of a priced company can sign in. Open
each ERP's screen from its card in Demo Builder's Integrations view (**Open**); keep Commerce
Admin open beside them.

| # | Do | Where | What to show |
|---|---|---|---|
| 1 | Sign in as a company buyer (Justrite: Dana Whitfield, Northgate) and put one product of each brand in one cart: a Justrite shadow board and two AccuformNMC signs | Storefront | Each line at the company's contract price (Northgate: Justrite less 10%, AccuformNMC less 15%) |
| 2 | Check out with Payment on Account | Storefront | The order places in seconds: as it is placed, each owning ERP is asked whether the company can carry its part (credit) and when it can ship (availability) |
| 3 | Open the order | Commerce: Sales → Orders | One order, Pending. A comment per ERP names the sales order it became |
| 4 | Open Sales Orders on each ERP | Each ERP: Sales Orders (`#orders`) | Justrite ERP holds only the shadow board, Accuform ERP only the signs, each as its own sales order for the same customer |
| 5 | In each ERP, open its order, **Confirm**, then create and **Post** a shipment | Each ERP: the sales order, then Shipments | The ERP ships from its own warehouse |
| 6 | Refresh the order | Commerce: Sales → Shipments and Invoices | Two shipments, each from that brand's inventory source (justrite, accuform), and two invoices, one per ERP (the shipping charge is on the first). The order reads Complete |
| 7 | Show the money | Commerce: Customers → Companies → Northgate, Company Credit | The order's total is on the company's credit balance |
| 8 | Enter one return for both lines (reason, condition, Refund) | Commerce: Sales → Returns, New (or the order's Returns tab) | One return, Pending. Returns are switched OFF for shoppers on Justrite (RMA Settings, "Enable RMA on Storefront"), so staff enter it here; with that setting on, the buyer asks for it on the storefront |
| 9 | Refresh the return | Commerce: the return | Within seconds: Authorized, with a comment per ERP ("Sent to Justrite ERP as return order …") |
| 10 | Open Returns on each ERP | Each ERP: Returns (`#returns`; Home cues "Returns to receive") | Each ERP holds a return order of only its line, against its own sales order, with the buyer's reason in words |
| 11 | In each ERP, open the return order and **Receive** | Each ERP: the return order | The goods are back in that ERP's warehouse; the Commerce return reads Received, with a "Goods received by …" comment per ERP |
| 12 | In each ERP, **Post credit memo** (the dialog says it cannot be undone) | Each ERP: the return order, then Credit Memos (`#creditMemos`) | The ERP's credit memo, linked from the return order and the invoice |
| 13 | Refresh | Commerce: Sales → Credit Memos; the return; the company's credit | One Commerce credit memo per ERP, each only that brand's lines; the return Processed and Closed; the company's credit balance back by the goods (shipping is not refunded) |
| 14 | Follow the order end to end | Commerce Admin: Apps → the integration → Activity (follow one order); either ERP's Event Journal (`#events`) | Every crossing, both ways, with its time |

**A credit memo without a return.** An ERP can credit its invoice in full: on its invoice
(`#invoices`, the invoice) press **Post credit memo**. Commerce gets a credit memo of only
that ERP's lines (proved on order 5000000003: the Accuform ERP's invoice credited, the
Justrite line untouched). An invoice with an open return refuses it, so a return is never left
uncreditable.

**What cannot be undone, and what to say about it.** A Commerce credit memo cannot be deleted,
and neither can a return over the API (retire one by closing it). The ERPs' Reset ERPs clears
the ERP side; Commerce keeps the credited orders. Rehearse on test orders, and expect the
company's credit balance to carry each rehearsal's orders less their credits.

## What this walk-through has not proved live

Written from the code and the preview on 2026-09-24. Before a first showing, walk it once
against a deployed pair and correct here anything that reads differently, in particular:
the Commerce order view's label for `ext_order_id`, the exact status words Commerce shows
after each ERP move, and the Admin page rendered by a real Commerce Admin.
