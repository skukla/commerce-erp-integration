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
| Products → ERP | product created/updated and stock events keep the ERP's products in step; companies, and the stock of every inventory source, are refreshed from Commerce every minute | `product-commerce/*`, `stock-commerce/updated`, `erp/refresh-partners` |
| ERP → Commerce | the ERP publishes its events to the ingestion webhook; they are published to Adobe I/O Events and the handlers apply them: price and name → product, stock → source item, credit limit and block → company (ledgered), order status → comment / shipment / invoice / cancel | `ingestion/webhook`, `*-backoffice/*` |
| Reset | undo what was written onto Commerce (every ledgered write: company credit limits and blocks, and the names, prices and stock the ERP decided; plus the ERP number on every ERP-numbered order) → wipe the ERP → mirror Commerce (products, stock, companies) into it again | `erp/reset` |
| Detach | the first half of reset alone: undo every ledgered write and clear the ERP numbers, leaving the ERP untouched. Demo Builder runs it before removing the integration | `erp/detach` |

**Commerce is the permanent system; the ERP is transient.** In a demo the SC's store is what
persists and the ERP is rebuilt at will, so everything this integration writes into Commerce
that Commerce CAN undo is recorded before the write and put back on removal: company credit
limits and blocks, and product names, prices and stock (`src/lib/ledger.js`, read by
`src/lib/commerce-before.js`). What stays is only what Commerce itself cannot delete — notes
in order histories, shipments, invoices and cancellations. ORDERS are the stated exception:
Commerce has no API to delete one, so the ERP's number is cleared from it instead. Any new
ERP → Commerce write has to answer the same question before it ships: can Commerce undo it,
and if so, where is it ledgered?
| Mirror | the import half of reset, run at first install | `erp/mirror` |
| Settings | per website or store view, kept by App Management's business configuration: send orders, hold orders while offline, a status on confirm, contract prices, discount ceiling; and the **Structure** group below. On the Admin screen each one sits on the card of the entity it joins (the **Mapping** tab, below) | `erp/settings`, `src/lib/settings.js` |
| Structure | the business-structure mapping, owned by Commerce because the merchant's structure is: per website, the ERP sales organisation that sells through it (`structure_sales_org`, four letters or digits, default `1000`) and its name; per pair at Default Config, the prefix on ERP order numbers (`structure_order_prefix`, blank derives it from the ERP's name) and which products belong to this ERP (`structure_owns`: all · the products stocked in named inventory sources · the products whose attribute names this ERP, with `structure_owns_sources` / `structure_owns_attribute`). Text settings are validated on save (`src/lib/settings.js` `TEXT_RULES`). The mirror, the product and stock events filter by ownership; the order carries the sales organisation | `app.commerce.config.ts`, `src/lib/structure.js` |
| History and Retry | what crossed and how it ended, kept 14 days in App Builder State. One record per order sent to the ERP — sent, waiting for the ERP, or not sent (`src/lib/history.js`) — and one per ERP event applied to Commerce — applied, not applied yet, or refused — under the event's own id, recorded by wrapping each ERP event handler (`src/lib/erp-event-history.js`). Each counts its tries. From the Admin screen a person can send an order again (the same send, as new; the website's settings still apply) or hand a saved ERP event to its handler again | `erp/history` |
| Commerce Admin screen | System → the ERP's name (`ERP_DISPLAY_NAME`, else "ERP integration"; Admin UI SDK). **Mapping**: one card per business concept the two systems share (buying organization, selling organization, sellable item, price, inventory position, credit, order, payment, fulfilment source), Commerce's records on the left, the ERP's on the right, the arrow saying which side owns each piece, the join in a sentence with the setting that makes it editable on the card, the card's other switches, the ERP's live figures and what has crossed each way; the Buying organization and Sellable item cards look up one company id or SKU as both systems hold it (`erp/lookup`). The settings are the mapping (`src/commerce-backend-ui-2/web-src/src/mapping-view.js`). **Status & sync**: health, counts, the controls, one order followed end to end, what crossed each way with a Retry on anything that did not get through | `src/commerce-backend-ui-2` |

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
ERP's copy (events for products and stock, the partner refresh every minute, the mirror at
install and reset). On stage the ERP looks like the system of record: an edit on its screen
is published as an ERP event, applied to Commerce here, and comes back on the next import as
the same value.
Reset returns the ERP to a fresh mirror of Commerce.

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

**This app → Commerce, on its own** (mirror, reset, detach, the minute refresh): `GET products`,
`GET inventory/source-items`, `GET inventory/sources` (source names, 404-tolerant), `GET company`,
`GET companyCredits/company/{id}`, `GET customers/{id}` (a company admin's website),
`GET store/websites` and `GET store/storeConfigs` (the structure block: each website, its base currency
and locale; Store Information is not readable over REST, so the ERP's Organisation card prints what
the store configuration says and nothing more); for an ownership check on a product or stock event,
`GET inventory/source-items` for that SKU or `GET products/{sku}`; reset and detach
also revert ledgered `PUT companyCredits/{id}` and `PUT company/{id}` and clear `ext_order_id`
with a sparse `POST orders` (entity id + the one field) on every order the ERP numbered.

**This app → the ERP**: `GET health`, `GET/PATCH settings`, `POST admin/wipe`,
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

## Develop

```bash
nvm use            # node 24
npm install
npm test           # vitest
aio app deploy     # into the workspace `aio app use` points at
```

App Management then installs the app into the Commerce instance (events, webhooks, the
Admin screen registration). Demo Builder drives that install and then starts the first sync
(`POST erp/mirror?background=true`); by hand, use the app's generated install API, then Sync
records on the Admin page or the ERP's Settings page.

### The pair in a box

`test/box/` runs the ERP in this process (the sibling `demo-erp` checkout, by path, against
its own in-memory database) behind this app's ERP client, with a fake Commerce in front
that records every write. `test/box/journeys.test.js` walks the entity matrix both ways
(order, confirm, shipment from either side, invoice, credit hold and release and reject,
cancel and hold made in Commerce, prices and stock with the ledger's revert on reset, the
minute stock refresh, product delete, company block and credit limit) and asks the two
questions the sync has to answer: did the change arrive, and did nothing come back twice.
The fake's shapes are typed from the 2.4.9 REST definitions, not captured live; the API
inventory (`docs/commerce-api-inventory.md`) replaces them with captures once a credential
exists. It runs with `npm test`.

## Licence

Apache-2.0. The scaffolding is the starter kit's, which is Adobe's under the same licence
(see COPYRIGHT).
