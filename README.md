# commerce-erp-integration

The Adobe Commerce half of Demo Builder's ERP integration, built on Adobe's
[Commerce integration starter kit](https://github.com/adobe/commerce-integration-starter-kit)
(App Management generation). Its other half is the ERP itself,
[skukla/demo-erp](https://github.com/skukla/demo-erp), a mock SAP-style system deployed in
the same App Builder workspace. Demo Builder installs and removes the two as a unit.

## The demo it serves

Data flowing back and forth between the store and an ERP that is shown as the system of
record: change a price, a stock level or a credit limit in the ERP and watch it land in
Commerce; place an order in Commerce and watch it appear in the ERP with an SAP-style
number; move the order through confirmed, shipped and invoiced in the ERP and watch the
Commerce order follow.

## What it does

| Direction | How | Where |
|---|---|---|
| Order → ERP | the order save event (`observer.sales_order_save_commit_after`), as Adobe's integration starter kit does it: a new order is created in the ERP, carrying the sales organisation its website's *Structure* setting names, and the ERP number is written back as `ext_order_id` with the pair's prefix in front (`ACME-0000001042`), with a note on the order. Under an ownership mode other than *All products*, an order with no line this ERP owns is skipped with a history entry saying why. While the ERP cannot take it, the website's *Hold orders while the ERP is offline* setting decides: on, I/O Events delivers again for up to a day; off, the order is not sent | `order-commerce/created` |
| Contract prices → cart | totals-collector `item_prices` webhook replaces each line's price with the ERP's contract price for the buyer's business partner | `webhook/item-prices` |
| Discount ceiling → cart | totals-collector `execute` webhook claws back discount below the ERP's maximum-discount ceiling | `webhook/discounts` |
| Products and companies → ERP | product created/updated and stock item events keep the ERP's products in step, each sending the product's stock at every inventory source; a company save sends that company as a business partner. Commerce raises no event for a quantity changed at a source outside the product page (its own Transfer, Import or a REST write), so moving stock between the ERP's warehouses goes through this app's **Move stock** mass action on the product grid, which tells the ERP at once | `product-commerce/*`, `stock-commerce/updated`, `company-commerce/saved`, `erp/move-stock` |
| Filling the ERP | removed from this app (2026-09-27). Demo Builder fills the ERP from Commerce itself: after the add, inside its Reset records (this app's `erp/detach`, then the ERP's `admin/wipe`, then the fill), and as Load demo data. It asks this app for the resolved settings per website (`erp/settings?websites=`). The mirror, its worker, the reset action and the every-minute partner and stock refresh are gone | Demo Builder |
| ERP → Commerce | the ERP publishes its events to the ingestion webhook; they are published to Adobe I/O Events and the handlers apply them: price and name → product, stock → source item, credit limit and block → company (ledgered), order status → comment / shipment / invoice / cancel | `ingestion/webhook`, `*-backoffice/*` |
| Key map | which Commerce company is which ERP customer: data this app keeps, never typed in and never known to the ERP. Demo Builder loads it whole after each fill (`PUT`), the way a key map is loaded at a go-live; products pair by SKU. The order sender sends the ERP customer number from it (`partnerId`), and so do the cart price and discount checks, from the company Commerce names on the cart (`quote.extension_attributes.company_id`, measured on Bodea 2026-09-27). Nothing else of Commerce's goes: since contract version 3 the ERP holds no Commerce id, so a company missing from the map is the ERP's walk-in customer, and an ERP credit or block event for a customer the map does not pair is skipped | `erp/keymap`, `src/lib/key-map.js` |
| Detach | undo what was written onto Commerce (every ledgered write: company credit limits and blocks, and the names, prices and stock the ERP decided; plus the ERP number on every ERP-numbered order), leaving the ERP untouched. Demo Builder runs it first in its Reset records and before removing the integration | `erp/detach` |

**Commerce is the permanent system; the ERP is transient.** In a demo the SC's store is what
persists and the ERP is rebuilt at will, so everything this integration writes into Commerce
that Commerce CAN undo is recorded before the write and put back on removal: company credit
limits and blocks, and product names, prices and stock (`src/lib/ledger.js`, read by
`src/lib/commerce-before.js`). What stays is only what Commerce itself cannot delete — notes
in order histories, shipments, invoices and cancellations. ORDERS are the stated exception:
Commerce has no API to delete one, so the ERP's number is cleared from it instead. Any new
ERP → Commerce write has to answer the same question before it ships: can Commerce undo it,
and if so, where is it ledgered?
| Settings | per website or store view, kept by App Management's business configuration: send orders, hold orders while offline, a status on confirm, contract prices, discount ceiling; and the **Structure** group below. On the Admin screen each one sits on the card of the entity it joins (the **Mapping** tab, below) | `erp/settings`, `src/lib/settings.js` |
| Structure | the business-structure mapping, owned by Commerce because the merchant's structure is: per website, the ERP sales organisation that sells through it (`structure_sales_org`, four letters or digits, default `1000`) and its name; per pair at Default Config, the prefix on ERP order numbers (`structure_order_prefix`, blank derives it from the ERP's name) and which products belong to this ERP (`structure_owns`: all · the products stocked in named inventory sources · the products whose attribute names this ERP, with `structure_owns_sources` / `structure_owns_attribute`). Text settings are validated on save (`src/lib/settings.js` `TEXT_RULES`). Demo Builder's fill and the product and stock events filter by ownership; the order carries the sales organisation | `app.commerce.config.ts`, `src/lib/structure.js` |
| History and Retry | what crossed and how it ended, kept 14 days in App Builder State. One record per order sent to the ERP — sent, waiting for the ERP, or not sent (`src/lib/history.js`) — and one per ERP event applied to Commerce — applied, not applied yet, or refused — under the event's own id, recorded by wrapping each ERP event handler (`src/lib/erp-event-history.js`). Each counts its tries. From the Admin screen a person can send an order again (the same send, as new; the website's settings still apply) or hand a saved ERP event to its handler again | `erp/history` |
| Commerce Admin screen | System → the ERP's name (`ERP_DISPLAY_NAME`, else "ERP integration"; Admin UI SDK). **Mapping**: one card per business concept the two systems share (buying organization, selling organization, sellable item, price, inventory position, credit, order, payment, fulfilment source), Commerce's records on the left, the ERP's on the right, the arrow saying which side owns each piece, the join in a sentence with the setting that makes it editable on the card, the card's other switches, the ERP's live figures and what has crossed each way; the Buying organization and Sellable item cards look up one company id or SKU as both systems hold it (`erp/lookup`). The settings are the mapping (`src/commerce-backend-ui-2/web-src/src/mapping-view.js`). **Status & sync**: health, counts, one order followed end to end, what crossed each way with a Retry on anything that did not get through | `src/commerce-backend-ui-2` |

Both cart webhooks are `required: false` with short soft timeouts on purpose: an ERP that is
slow or away never breaks a cart. Orders are never held up at checkout: they reach the ERP
after they are saved.

**Changing a webhook or event after install.** App Management's installer skips a webhook that
is already subscribed and never updates it, and uninstall removes only what the current config
lists. So a changed `required`, timeout or field list, a new event, or a removed webhook reaches
Commerce only through an uninstall run with the old config, then an install with the new one.

**Looking at the Admin page without Commerce.** `npm run preview` builds the page's own
components against stand-in data (`preview/`) and serves it on 8978. It is the real shell,
the real components and the real build pipeline — only the answers are made up — so the
layout can be checked without a Commerce Admin, a sign-in or a deployed app. Build it with
Parcel, not another bundler: Spectrum's styles come from a build-time macro, and without it
everything renders unstyled. `?tab=status` opens the other tab.

**Two ERPs on one Commerce.** Commerce knows an App Management app by its `metadata.id`, and
the library names the app's webhooks and events from it. Demo Builder deploys a second copy
with `DEMO_BUILDER_COPY_NUMBER` set (`2`), which makes its id `erp-integration-2` and its menu
id `erp_integration_2` (`app.commerce.config.ts`); the first copy is deployed without it and
keeps `commerce-erp-integration`, since an installed app's id cannot change. A copy's id must
not start with another's: the library counts a webhook as an app's by that prefix.

**Who is the master.** The SC prepares the demo in Commerce, so Commerce is the master and
the ERP adapts to it: every product, stock and company change in Commerce overwrites the
ERP's copy (events for products, stock and companies; Demo Builder's fill at install and
reset). On stage the ERP looks like the system of record: an edit on its screen
is published as an ERP event, applied to Commerce here, and comes back on the next import as
the same value.
Demo Builder's Reset records returns the ERP to a fresh copy of Commerce.

## APIs and events, in one place

How the events travel, why every Commerce subscription is priority (the sandbox's normal event
cron does not run), and where to look when one does not arrive: [`docs/eventing.md`](docs/eventing.md).

**Commerce → this app**

| Kind | Name | Handler |
|---|---|---|
| webhook (totals collector) | `plugin.out_of_process_totals_collector.api.get_total_modifications.item_prices` | `webhook/item-prices` → ERP `POST pricing/quote`, answers `replace result/price_updates` |
| webhook (totals collector) | `plugin.out_of_process_totals_collector.api.get_total_modifications.execute` | `webhook/discounts` → ERP `POST pricing/quote`, answers `replace result` (negative `base_discount`) |
| event | `observer.catalog_product_save_commit_after` | `product-commerce/created`, `product-commerce/updated` → ERP `POST admin/import` |
| event | `observer.catalog_product_delete_commit_after` | `product-commerce/deleted` → ERP `DELETE products/{sku}` (a deleted parent's variants stay as products of their own) |
| event | `observer.company_save_commit_after` | `company-commerce/saved` → ERP `POST admin/import` (the company read back by id and sent as a business partner) |
| event | `observer.sales_order_save_commit_after` | `order-commerce/created` → Commerce `GET orders` (entity by increment id) → ERP `POST orders` → Commerce `POST orders` (`ext_order_id`) and `POST orders/{id}/comments` |
| event | `observer.sales_order_save_commit_after` (saves that are not a new order) | `order-commerce/changed` → asks the ERP `GET orders/{number}` first (rule M2) → ERP `POST orders/{number}/cancel`, `/credit/hold` or `/credit/release`, each with an `origin` so the ERP does not echo it |
| event | `observer.sales_order_shipment_save_after` | `order-commerce/shipped` → Commerce `GET orders/{id}` → ERP `GET orders/{number}` → ERP `POST orders/{number}/commerce-shipment` (origin) |
| event | `observer.sales_order_invoice_save_after` | `order-commerce/invoiced` → Commerce `GET orders/{id}` → ERP `GET orders/{number}` → ERP `POST orders/{number}/commerce-invoice` (origin) |
| event | `observer.cataloginventory_stock_item_save_commit_after` | `stock-commerce/updated` → Commerce `GET products` (SKU by id) → ERP `POST admin/import` |

**ERP → this app** (the ERP posts to `ingestion/webhook`, published to the `erp` provider)

| ERP event | Handler | Commerce REST call |
|---|---|---|
| `be-observer.catalog_product_update` | `product-backoffice/updated` | `PUT products/{sku}` (name, price) |
| `be-observer.catalog_stock_update` | `stock-backoffice/updated` | `POST inventory/source-items` |
| `be-observer.sales_order_status_update` | `order-backoffice/updated` | `POST orders/{id}/comments` |
| `be-observer.sales_order_shipment_create` | `order-backoffice/shipment-created` | `POST order/{id}/ship` |
| `be-observer.sales_order_invoice_create` | `order-backoffice/invoice-created` | `POST order/{id}/invoice`, `POST orders/{id}/comments` |
| `be-observer.sales_order_cancel` | `order-backoffice/cancelled` | `GET orders/{id}`, `POST orders/{id}/unhold` when On Hold, `POST orders/{id}/cancel` |
| `be-observer.sales_order_hold` | `order-backoffice/hold` | asks the ERP `GET orders/{number}` first (rule M2); `GET orders/{id}`, `POST orders/{id}/hold` or `/unhold`, `POST orders/{id}/comments` |
| `be-observer.company_credit_update` | `company-backoffice/credit-updated` | `GET companyCredits/company/{id}`, `PUT companyCredits/{id}` (ledgered) |
| `be-observer.company_status_update` | `company-backoffice/status-updated` | `GET company/{id}`, `PUT company/{id}` (ledgered) |

**This app → Commerce, on its own** (the events above, move stock, detach): for a product or
stock event, `GET inventory/source-items` for that SKU and `GET inventory/sources` (source names,
404-tolerant), and for an ownership check `GET products/{sku}`; for a company event, `GET company/{id}`,
`GET companyCredits/company/{id}`, `GET customers/{id}` (a company admin's website) and
`GET store/websites`; move stock uses Commerce's `POST inventory/bulk-product-source-transfer` and
`POST inventory/bulk-partial-source-transfer`; detach reverts ledgered `PUT companyCredits/{id}` and `PUT company/{id}` and clear `ext_order_id`
with a sparse `POST orders` (entity id + the one field) on every order the ERP numbered.

**This app → the ERP**: `GET health`, `GET/PATCH settings`,
`POST admin/import`, `POST pricing/quote`, `POST orders`, `GET orders`, `GET orders/{number}`,
`GET products/{sku}`, `GET partners`, `GET partners/{id}` (the Admin page's look-up), `DELETE products/{sku}`.

**The pin.** [`contract/erp-contract.json`](contract/erp-contract.json) is the ERP's own
contract, vendored. `test/contract/erp-contract.test.js` fails when this app subscribes to an
event the ERP does not raise, handles keys it does not send, or calls a route it does not
serve. `npm run contract:check` fetches the ERP's current contract and says when the vendored
copy is behind.

## After you install

Two things Commerce needs that no API does:

1. **An order status for "confirmed in the ERP".** Commerce lets a comment set only a status of
   the order's current state, and a new order stays Pending until it is invoiced or shipped. So
   an order the ERP confirmed looks the same as one it never saw, unless it has a status of its
   own. In Admin: **Stores > Settings > Order Status**, create `erp_confirmed` ("Confirmed in
   ERP"), assign it to **Pending** (not as the default), then pick it for "Order status when the
   ERP confirms" on this app's **Mapping** tab. Without it the confirmation is a note only.
2. **A shared catalog of its own for each company that gets its own prices.** At the cart,
   Commerce tells the pricing webhooks only the buyer's customer group, so companies that share a
   group get the same prices. A shared catalog comes with its own customer group: **Catalog >
   Shared Catalogs > Add Shared Catalog**, then **Assign Companies**.

The event provider id Commerce's eventing configuration needs is set by the install itself
(`src/installation/set-event-provider.js`); nothing to paste.

## What the Commerce instance needs

One ERP needs nothing beyond a store: every setting has a default. The business-structure
story (two websites as two sales organisations) and the two-ERP story (products split by
inventory source or by an `erp_owner` attribute, a prefix per pair) need things prepared in
Commerce first. [`docs/demo-setup.md`](docs/demo-setup.md) says what, where in the Admin, how to
check it over the API, and how to undo each one.

**What live testing taught.** [`docs/live-validation-learnings.md`](docs/live-validation-learnings.md)
is the ledger of facts learned against a real instance, each with the test that pins it. A live
run that teaches something new adds a row there in the same commit as the fix.

**Giving the demo.** [`docs/walkthrough.md`](docs/walkthrough.md) walks the ERP screen by screen
along the twenty-minute path, then Commerce from the other side, and closes with one table per
business concept saying which screen on each side holds it and what joins them (the printable
twin of the Admin page's Mapping tab).

## Inputs

| Variable | What |
|---|---|
| `ERP_BASE_URL` | the ERP's web-action base (`…/api/v1/web/demo-erp`); Demo Builder writes it from the ERP component's deployed URLs |
| `ERP_DISPLAY_NAME` | what the ERP is called in comments and on the Admin screen |
| `AIO_COMMERCE_AUTH_IMS_*` | the server-to-server credential the deploy injects; it authenticates calls to Commerce and to the ERP (the ERP's actions are `require-adobe-auth`) |

## Code layout

Laid out the way a customer would build an integration for several ERPs (the several-ERPs
design, v1). Adobe's starter-kit actions stay where the kit puts them
(`src/commerce-extensibility-1/actions/<entity>/commerce|external/`); four pieces sit beside them:

| Piece | Where | What it is |
|---|---|---|
| The router | `src/router/route-order.js` | Where a placed order goes first. It knows no ERP: it reads the ERP list, gives each line to the ERP that owns its product, and hands each ERP only its lines through that ERP's adapter. With one ERP it passes the whole order through, exactly as before. With several, a product's owner is the ERP whose id its `erp_owner` attribute holds (or the ERP's own ownership setting); a line no ERP owns is held back, and a line two ERPs claim is a setup error sent to neither |
| The order's parts | `src/lib/order-parts.js` | One record per order in App Builder State (`order-parts-<order number>`): each ERP's part, what happened to it, and the lines held back. A redelivered order event sends only the parts that did not reach their ERP |
| Outcomes and the combined status | `src/router/part-outcomes.js`, `src/router/combined-status.js` | Each ERP message (hold, release, cancel, shipment, invoice, status) is matched to its part: the ERP the message names, else the one part holding its ERP sales order number. The ERP's adapter reads it into the part's outcome, the order's history gets one line under the ERP's name, and the router writes the combined status, the only writer of it: On Hold while any part is held, failed, cancelled by its ERP, or a line reached no ERP; Pending until every part is sent; Processing while parts move; Complete is Commerce's own. The order is never cancelled automatically, and with several ERPs the whole order is not invoiced (each part's partial invoice is the next slice). ERP numbers live in the history and the parts record; the one ERP-number field on the order (`ext_order_id`) is written only when there is one ERP. With one ERP none of this runs: the messages act on the whole order exactly as before |
| Ownership | `src/router/ownership.js` | The one place that says which ERP owns a product; the router and the cart checks both ask it |
| Cart prices per ERP | `src/lib/cart-quotes.js` | Both cart checks (contract prices and the discount ceiling) ask each owning ERP, at the same time, for its own lines' prices, at its own address and as its own customer for the cart's company, and merge the answers into one response. An ERP that fails or times out leaves its lines at Commerce's price; it never fails the cart. With one ERP it is today's single request |
| The Admin lookup per ERP | `erp/lookup` | With several ERPs a company is shown as it stands in each ERP (its customer there, from the key map, asked at that ERP's address), answered as `erps: [one lookup per ERP]`, and a SKU is shown in the ERP that owns it (`owner`). With one ERP the answer is unchanged |
| Per-ERP settings | `src/lib/erp-settings.js`, `erp/erps` | Settings that differ per ERP live on that ERP's entry in the ERP list: which products it owns, its order-number prefix, and its sales organisation (per website if need be). Settings for the whole integration (send orders, hold when offline, the confirm status, contract prices, the discount ceiling) stay in App Management's configuration. An entry's value wins; anything it does not set is the integration's configured value, so one ERP with no entry settings behaves exactly as before. The Admin page saves one ERP's settings with `PATCH erp/erps`; each part of a split order is sent with its ERP's settings for the order's website; `GET erp/settings?websites=...&erp=<id>` answers one ERP's view (Demo Builder's fill) |
| The contract | `src/adapters/contract.js` | The two functions every adapter implements: `sendPart` (send this ERP its part) and `readOutcome` (turn the ERP's message into the part's outcome) |
| The adapters | `src/adapters/<kind>/` | One folder per KIND of ERP. `demo-erp/` talks to the demo ERP; `example/` is a commented skeleton showing what adding another kind takes |
| The ERP list | `src/lib/erps.js`, `erp/erps` | One entry per ERP: an `id` that never changes (the key for everything), a `name` for people, its adapter kind, and its connection. Demo Builder stores the list in App Builder State when an SC adds or removes an ERP (`PUT erp/erps`, checked: unique ids and names, a known adapter kind, an https address). With nothing stored, the list is one ERP, id `erp`, from the deployed settings, so a single-ERP install works exactly as before. Each ERP names itself on the events it sends (`erpId`, contract version 4) when it was deployed with an `ERP_ID` |

A company buying from several ERPs is a customer in each: the key map pairs it once per ERP (`erpId` on each entry; an entry without it is the single ERP's), a company saved in Commerce goes to every ERP, and each ERP's part of an order names the buyer by that ERP's customer number.

Adding an ERP of a kind already built is one line in the ERP list. Adding a new kind is one
adapter folder (copy `example/`) plus that line. The router, the storefront and the other
adapters do not change.

## Develop

```bash
nvm use            # node 24
npm install
npm test           # vitest
aio app deploy     # into the workspace `aio app use` points at
```

App Management then installs the app into the Commerce instance (events, webhooks, the
Admin screen registration). Demo Builder drives that install and then fills the ERP from Commerce
itself; by hand, use the app's generated install API, then Demo Builder's Load demo data.

### The pair in a box

`test/box/` runs the ERP in this process (the sibling `demo-erp` checkout, by path, against
its own in-memory database) behind this app's ERP client, with a fake Commerce in front
that records every write. `test/box/journeys.test.js` walks the entity matrix both ways
(order, confirm, shipment from either side, invoice, credit hold and release and reject,
cancel and hold made in Commerce, prices and stock with the ledger's revert on detach, a stock
item save sending every source, product delete, company block and credit limit) and asks the two
questions the sync has to answer: did the change arrive, and did nothing come back twice.
The fake's shapes are typed from the 2.4.9 REST definitions, not captured live; the API
inventory (`docs/commerce-api-inventory.md`) replaces them with captures once a credential
exists. It runs with `npm test`.

## Licence

Apache-2.0. The scaffolding is the starter kit's, which is Adobe's under the same licence
(see COPYRIGHT).
