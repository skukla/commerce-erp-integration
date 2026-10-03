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
| Order → ERP | the order save event (`observer.sales_order_save_commit_after`), as Adobe's integration starter kit does it: a new order is created in the ERP, carrying the sales organization its website's *Structure* setting names, and the ERP number is written back as `ext_order_id` with the pair's prefix in front (`ACME-0000001042`), with a note on the order. Each line goes at Commerce's `base_price`; a line a cart price rule discounted also carries the row's discount (`items[].base_discount_amount`, sent as the ERP line's `discount`, its contract version 17), so the ERP's lines add up to what the buyer paid and its invoice and credit memos carry the discount through. An order Commerce captured a payment for at checkout (a card, through Payment Services or Cybersource) also carries a payment reference (its contract version 18): the method, the gateway's transaction id (`last_trans_id`), the card brand and last four digits, and the amount captured, read from the order over REST through an allow-list (`src/lib/payment-reference.js`), never a card number; one ERP's part of a split order carries its own part's total as its share. The ERP then posts its invoice as paid and raises no payment event, so no company credit moves. The ERP does not reprice the order. Under an ownership mode other than *All products*, an order with no line this ERP owns is skipped with a history entry saying why. While the ERP cannot take it, the website's *Hold orders while the ERP is offline* setting decides: on, I/O Events delivers again for up to a day; off, the order is not sent | `order-commerce/created` |
| Contract prices → shared catalogs | each ERP's contract prices in force become tier prices for the customer group of the company's custom shared catalog: a price line a fixed price, a discount line a percentage, at the line's minimum quantity, on every website (where Commerce's own catalog pricing stores them). Only the SKUs that ERP owns, for the company the key map pairs with its customer; applied as a replace against what that ERP wrote before, and ledgered, so detach takes them back. A company with no custom shared catalog of its own gets none, reported as skipped. The ERP's customer prices event applies one customer's set at once; `erp/prices` (POST `{ erpId? }`) publishes every customer's set from `GET contracts/in-force`. Demo Builder runs it after a fill, and the scheduled price publish runs the same publish so a price line's start or end date, which raises no event, takes effect: by default every hour at five past, UTC (see **Schedules**); the publish writes only changes. The cart, the listing and the product page all price from Commerce: no ERP is asked on a cart change, and a discount limit is the ERP's to enforce on the order (AB-26z, 2026-09-28) | `erp/prices`, `erp/scheduled`, `company-backoffice/contract-updated`, `src/lib/contract-prices.js` |
| Products and companies → ERP | product created/updated and stock item events keep the ERP's products in step, each sending the product's stock at every inventory source; a company save sends that company as a business partner. Commerce raises no event for a quantity changed at a source outside the product page (its own Transfer, Import or a REST write), so moving stock between the ERP's warehouses goes through this app's **Move stock** mass action on the product grid, which tells the ERP at once | `product-commerce/*`, `stock-commerce/updated`, `company-commerce/saved`, `erp/move-stock` |
| Filling the ERP | removed from this app (2026-09-27). Demo Builder fills the ERP from Commerce itself: after the add, inside its Reset records (this app's `erp/detach`, then the ERP's `admin/wipe`, then the fill), and as Load demo data. It asks this app for the resolved settings per website (`erp/settings?websites=`). The mirror, its worker, the reset action and the every-minute partner and stock refresh are gone | Demo Builder |
| ERP → Commerce | the ERP publishes its events to the ingestion webhook; they are published to Adobe I/O Events and the handlers apply them: price and name → product, stock → source item, credit limit → company (ledgered), credit block → holds that ERP's orders of the company (never the company's own Active/Blocked switch, which reaches the ERP as its read-only website account), order status → comment / shipment / invoice / cancel | `ingestion/webhook`, `*-backoffice/*` |
| Key map | which Commerce company is which ERP customer: data this app keeps, never typed in and never known to the ERP. Demo Builder loads it whole after each fill (`PUT`), the way a key map is loaded at a go-live; products pair by SKU. The order sender sends the ERP customer number from it (`partnerId`), and an ERP's contract prices go to the company it pairs with that ERP's customer. Nothing else of Commerce's goes: since contract version 3 the ERP holds no Commerce id, so a company missing from the map is the ERP's walk-in customer, and an ERP credit or block event for a customer the map does not pair is skipped | `erp/keymap`, `src/lib/key-map.js` |
| Detach | undo what was written onto Commerce (every ledgered write: company credit limits, company blocks an older version wrote, the names, prices and stock the ERP decided, and the contract prices written into shared catalogs as tier prices; plus the ERP number on every ERP-numbered order), leaving the ERP untouched. Demo Builder runs it first in its Reset records and before removing the integration. With `erp` (query or body, a listed ERP's id), only that ERP is undone and the answer names it as `erp`: its products, tier prices and orders (the ones its own order list names), and its share of each company's credit, where its `erp_<id>_*` attributes come off the set and the credit limit becomes the total the other ERPs still hold, or what Commerce had before when none holds one. Every ledger entry names its ERP; one that names none is the first ERP's (`erp`). An ERP not in the list is refused with a 400. A deployment from before this ignores `erp` and undoes every ERP, so `erp/status` answers `detachesPerErp: true` for a caller to check first (AB-16c). With `closeOrders` (body `true` or query `"true"`; refused with a 400 alongside `erp`), a reset closes off every order the ERPs hold before it wipes them (AB-16n): every order an ERP's list names or that has a parts record. One with nothing invoiced or shipped, in a state Commerce cancels from, is canceled (`POST orders/{id}/cancel`, off hold first) and noted "Canceled by the demo reset on <day>."; any other, or one Commerce refuses to cancel, is only noted "The ERP documents for this order were removed by the demo reset on <day>." (day in UTC). Its parts record is deleted, its ERP number cleared, its hold released. Each order is marked closed in State (`order-reset-closed-<number>`) before the first write, and `order-commerce/created` sends no marked order, so the saves the close makes reach no ERP. An order whose history already carries a reset's note is counted `alreadyClosed` and not noted again. The answer adds `closed: { cancelled, commented, alreadyClosed, partsRemoved, failed: [{ orderId, error }] }` only when it closed; a deployment from before this ignores `closeOrders`, so `erp/status` answers `closesOrdersOnReset: true` for a caller to check first. A canceled order stays canceled: Commerce can neither delete nor reopen one. The same reset then starts the Admin page's Activity again: every history record is deleted, every scheduled job's last run and last change are forgotten, and one "Demo reset" line records what the reset closed (the answer adds `activity: { historyCleared, scheduledCleared }`); removing the integration leaves them alone. A scheduled job keeps the scheduled moment it last ran for, so the reset does not make it due: it next runs at its next scheduled moment, not on the next five-minute heartbeat (which would republish prices from ERPs the reset is about to wipe). With `run` (query or body: an id the caller chooses, 8 to 64 letters, digits, hyphens and underscores; anything else is a 400), the detach can be asked about afterwards: a web action's HTTP answer is cut off at 60 seconds (a 504) while the detach runs on, so `GET erp/detach?run=<id>` answers its record from App Builder State (`detach-run-<id>`, kept one day): `{ run, status: "running", startedAt }`, then `{ run, status: "done", startedAt, finishedAt, result }` with the body the POST answers, or `{ run, status: "failed", startedAt, finishedAt, error }`; a 404 when there is no such run. Only POST detaches: GET without `run`, and any other method, is a 400. A deployment from before this would run a detach on GET, so `erp/status` answers `detachRuns: true` for a caller to check before it polls | `erp/detach`, `src/lib/detach-erp.js`, `src/lib/close-orders.js`, `src/lib/detach-runs.js` |

**Commerce is the permanent system; the ERP is transient.** In a demo the SC's store is what
persists and the ERP is rebuilt at will, so everything this integration writes into Commerce
that Commerce CAN undo is recorded before the write and put back on removal: company credit
limits, product names, prices and stock, and contract tier prices, which are deleted or given
back the price they held (`src/lib/ledger.js`, read by
`src/lib/commerce-before.js`). What stays is only what Commerce itself cannot delete — notes
in order histories, shipments, invoices and cancellations. ORDERS are the stated exception:
Commerce has no API to delete one, so the ERP's number is cleared from it instead. Any new
ERP → Commerce write has to answer the same question before it ships: can Commerce undo it,
and if so, where is it ledgered?
| Settings | per website or store view, kept by App Management's business configuration: send orders, hold orders while offline, a status on confirm; and the **Structure** group below. Edited in the Admin page's **Settings** section | `erp/settings`, `src/lib/settings.js` |
| Schedules | scheduled jobs run on a schedule a business user sets, not one fixed at deploy (AB-38). One App Builder alarm, a heartbeat every five minutes (`erp-schedule-heartbeat`, cron `*/5 * * * *`), starts `erp/scheduled`, which reads each job's schedule from the settings at Default Config and runs the jobs that are due. The settings: the store timezone (`schedule_timezone`, an IANA name, default `UTC`) and, per job, on or off, hourly at a minute, daily at a time, or weekly on a day at a time (`schedule_prices_*` for the price publish, the only job today; default on, hourly at :05). A job is due when its latest scheduled moment, read in the store timezone, has come and it has not run for that moment; the moment is claimed in the job's record before it runs (`src/lib/scheduled-runs.js`), so a repeated tick does not run it twice, a heartbeat that was down runs it once, and a failed run waits for its next moment. Edited in the Admin page's **Settings** section, card **Schedules**, or in App Management's configuration. I/O Runtime reads an alarm's cron in UTC only (developer.adobe.com/app-builder/docs/resources/cron-jobs/lesson3), which is why the timezone is the integration's to apply | `erp/scheduled`, `src/lib/schedule.js` |
| Structure | the business-structure mapping, owned by Commerce because the merchant's structure is: per website, the ERP sales organization that sells through it (`structure_sales_org`, four letters or digits, default `1000`) and its name; per pair at Default Config, the prefix on ERP order numbers (`structure_order_prefix`, blank derives it from the ERP's name) and which products belong to this ERP (`structure_owns`: all · the products stocked in named inventory sources · the products whose attribute names this ERP · the products sold on named websites, with `structure_owns_sources` / `structure_owns_attribute` / `structure_owns_websites`; an order comes from one website, and a product rule beats a website rule, so the website ERP is that site's catch-all — `src/router/ownership.js`). Text settings are validated on save (`src/lib/settings.js` `TEXT_RULES`). Demo Builder's fill and the product and stock events filter by ownership; the order carries the sales organization | `app.commerce.config.ts`, `src/lib/structure.js` |
| History and Retry | what crossed and how it ended, kept 14 days in App Builder State. One record per order sent to the ERP — sent, waiting for the ERP, or not sent (`src/lib/history.js`) — and one per ERP event applied to Commerce — applied, not applied yet, or refused — under the event's own id, recorded by wrapping each ERP event handler (`src/lib/erp-event-history.js`). Each counts its tries. From the Admin screen a person can send an order again (the same send, as new; the website's settings still apply) or hand a saved ERP event to its handler again | `erp/history` |
| Commerce Admin screen | Apps → the integration's name → Integration (`INTEGRATION_DISPLAY_NAME`, else "ERP Integration"; Admin UI SDK). Three sections: **Overview** (whether the ERP answers, what it holds, a company or SKU looked up in both systems with `erp/lookup`, the record controls), **Activity** (what crossed each way, with Retry, one order followed end to end, and the scheduled price publish: when it last ran and what it changed) and **Settings** (the settings above, per scope and, with several ERPs, per ERP). The Mapping view, one card per concept the two systems share, was removed from the page in ec40ca5 and is planned again (AB-26m) | `src/commerce-backend-ui-2` |

No webhook: no ERP is asked while a buyer shops, so an ERP that is slow or away never breaks a
cart. Orders are never held up at checkout: they reach the ERP after they are saved.

**Changing a webhook or event after install.** A webhook REMOVED from the config is removed from
Commerce by an ordinary upgrade: measured on 2026-09-28, upgrading an install from 0.8.9 to
0.9.1 took the two cart webhooks (contract price and discount ceiling, AB-26z) off the store
(`GET V1/webhooks/list` listed both before the upgrade and none after). The same upgrade registered a NEW event (the
ERP's customer prices event reached its handler within two minutes). Not measured: whether an
upgrade changes a webhook that is already subscribed (its `required`, timeout or field list). If
a change does not arrive after an upgrade, uninstall and install the app again; Commerce's `POST V1/webhooks/unsubscribe` removes one webhook by its method, type, batch
and hook name.

**Looking at the Admin page without Commerce.** `npm run preview` builds the page's own
components against stand-in data (`preview/`) and serves it on 8978. It is the real shell,
the real components and the real build pipeline — only the answers are made up — so the
layout can be checked without a Commerce Admin, a sign-in or a deployed app. Build it with
Parcel, not another bundler: Spectrum's styles come from a build-time macro, and without it
everything renders unstyled. `?section=activity` or `?section=settings` opens that section.

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
| event | `observer.catalog_product_save_commit_after` | `product-commerce/created`, `product-commerce/updated` → ERP `POST admin/import` |
| event | `observer.catalog_product_delete_commit_after` | `product-commerce/deleted` → no ERP call: the delete is recorded in the Admin page's Activity ("Product deleted", In Commerce); the ERP keeps the product until its next reset (with several ERPs the record names the ERP the event's `erp_owner` names) |
| event | `observer.company_save_commit_after` | `company-commerce/saved` → ERP `POST admin/import` (the company read back by id and sent as a business partner) |
| event | `observer.sales_order_save_commit_after` | `order-commerce/created` → Commerce `GET orders` (entity by increment id) → ERP `POST orders` → Commerce `POST orders` (`ext_order_id`) and `POST orders/{id}/comments` |
| event | `observer.sales_order_save_commit_after` (saves that are not a new order) | `order-commerce/changed` → asks the ERP `GET orders/{number}` first (rule M2) → ERP `POST orders/{number}/cancel`, `/credit/hold` or `/credit/release`, each with an `origin` the ERP journals; the ERP raises its own event for it (contract version 19) and the ingestion webhook drops that echo (`lib/own-writes.js`) |
| event | `observer.sales_order_shipment_save_after` | `order-commerce/shipped` → Commerce `GET orders/{id}` → ERP `GET orders/{number}` → ERP `POST orders/{number}/external-shipment` (origin) |
| event | `observer.sales_order_invoice_save_after` | `order-commerce/invoiced` → Commerce `GET orders/{id}` → ERP `GET orders/{number}` → ERP `POST orders/{number}/external-invoice` (origin) |
| event | `observer.cataloginventory_stock_item_save_commit_after` | `stock-commerce/updated` → Commerce `GET products` (SKU by id) → ERP `POST admin/import` |

**ERP → this app** (the ERP posts a CloudEvent in its own words to `ingestion/webhook`; the one
translation module, `src/commerce-extensibility-1/actions/ingestion/translate.js`, turns each
ERP type into the starter-kit event below, finding Commerce's ids from this app's own records
and reads, and that is published to the `erp` provider. ERP contract version 16, AB-26y.
Version 19: an event about an order the ERP made itself, with no customer reference (Repeat
order), publishes nothing; and the ERP raises its events for changes this app sent it from
Commerce too, so the webhook drops the event that echoes such a change, known from
`src/lib/own-writes.js`, which remembers each change as it is sent)

| ERP type | Published as |
|---|---|
| `SalesOrder.Changed` | `be-observer.sales_order_status_update` (confirmed), `be-observer.sales_order_cancel` (canceled), `be-observer.sales_order_hold` (credit block on or off) |
| `OutboundDelivery.GoodsIssueStatusChanged` | `be-observer.sales_order_shipment_create` |
| `BillingDocument.Created` | `be-observer.sales_order_invoice_create` (Invoice), `be-observer.sales_order_creditmemo_create` (CreditMemo) |
| `CustomerReturn.Changed` | `be-observer.rma_status_update` (received) |
| `IncomingPayment.Posted` | `be-observer.sales_order_payment_create` |
| `Product.Changed` | `be-observer.catalog_product_update` (name or list price changed; a sales status alone is nothing to publish) |
| `ProductStock.Changed` | `be-observer.catalog_stock_update` |
| `Customer.Changed` | `be-observer.company_credit_update` (credit limit), `be-observer.company_status_update` (blocking level folded to blocked or not, only when that flips) |
| `PriceList.Changed` | `be-observer.company_contract_update` |

An unknown type answers 400 and is logged; an order Commerce cannot find yet by the customer's
order number answers 503, so the ERP delivers it again.

| Starter-kit event | Handler | Commerce REST call |
|---|---|---|
| `be-observer.catalog_product_update` | `product-backoffice/updated` | `PUT products/{sku}` (name, price) |
| `be-observer.catalog_stock_update` | `stock-backoffice/updated` | `POST inventory/source-items` |
| `be-observer.sales_order_status_update` | `order-backoffice/updated` | `POST orders/{id}/comments` |
| `be-observer.sales_order_shipment_create` | `order-backoffice/shipment-created` | `POST order/{id}/ship` |
| `be-observer.sales_order_invoice_create` | `order-backoffice/invoice-created` | `POST order/{id}/invoice`, `POST orders/{id}/comments` |
| `be-observer.sales_order_cancel` | `order-backoffice/cancelled` | `GET orders/{id}`, `POST orders/{id}/unhold` when On Hold, `POST orders/{id}/cancel`; an order Commerce keeps (invoiced or shipped) is put On Hold, and one whose card was captured at checkout says the card payment is refunded in the web shop, with a credit memo from its invoice (nothing here refunds it) |
| `be-observer.sales_order_hold` | `order-backoffice/hold` | asks the ERP `GET orders/{number}` first (rule M2); `GET orders/{id}`, `POST orders/{id}/hold` or `/unhold`, `POST orders/{id}/comments` |
| `be-observer.company_credit_update` | `company-backoffice/credit-updated` | `GET companyCredits/company/{id}`, `PUT companyCredits/{id}` (ledgered) |
| `be-observer.company_status_update` | `company-backoffice/status-updated` | `GET company/{id}`, `PUT company/{id}` (ledgered) |
| `be-observer.company_contract_update` | `company-backoffice/contract-updated` | one customer's prices in force as tier prices: `GET company/{id}`, `GET sharedCatalog`, `GET customerGroups/{id}`, `POST products/tier-prices-information`, `POST products/tier-prices`, `POST products/tier-prices-delete` (ledgered) |

**This app → Commerce, on its own** (the events above, move stock, detach): for a product or
stock event, `GET inventory/source-items` for that SKU and `GET inventory/sources` (source names,
404-tolerant), and for an ownership check `GET products/{sku}`; for a company event, `GET company/{id}`,
`GET companyCredits/company/{id}`, `GET customers/{id}` (a company admin's website) and
`GET store/websites`; move stock uses Commerce's `POST inventory/bulk-product-source-transfer` and
`POST inventory/bulk-partial-source-transfer`; contract prices read `GET company/{id}`,
`GET sharedCatalog` (filtered by the company's customer group), `GET customerGroups/{id}`
and `POST products/tier-prices-information`, and write `POST products/tier-prices` and
`POST products/tier-prices-delete`; detach reverts ledgered `PUT companyCredits/{id}` and
`PUT company/{id}` and the ledgered tier prices, and clears `ext_order_id`
with a sparse `POST orders` (entity id + the one field) on every order the ERP numbered. Detach of
one ERP also reads `GET company/{id}` and writes the set back without that ERP's attributes with
`POST company/setCustomAttributes`.

**This app → the ERP**: `GET health`, `GET/PATCH settings`,
`POST admin/import`, `GET contracts/in-force` (`erp/prices`), `POST orders`, `GET orders`, `GET orders/{number}`,
`GET products/{sku}`, `GET partners`, `GET partners/{id}` (the Admin page's look-up). No product is deleted in the ERP (its contract version 17 has no such route).

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
   ERP confirms" in this app's **Settings** section. Without it the confirmation is a note only.
2. **A shared catalog of its own for each company that gets its own prices.** The ERP's
   contract prices are written as tier prices for the customer group of the company's custom
   shared catalog, so companies that share a group would share prices, and a company on the
   public catalog gets none (it is reported as skipped). A shared catalog comes with its own
   customer group: **Catalog > Shared Catalogs > Add Shared Catalog**, then **Assign
   Companies**.

The event provider id Commerce's eventing configuration needs is set by the install itself
(`src/installation/set-event-provider.js`); nothing to paste.

## What the Commerce instance needs

One ERP needs nothing beyond a store: every setting has a default. The business-structure
story (two websites as two sales organizations) and the two-ERP story (products split by
inventory source or by an `erp_owner` attribute, a prefix per pair) need things prepared in
Commerce first. [`docs/demo-setup.md`](docs/demo-setup.md) says what, where in the Admin, how to
check it over the API, and how to undo each one.

**What live testing taught.** [`docs/live-validation-learnings.md`](docs/live-validation-learnings.md)
is the ledger of facts learned against a real instance, each with the test that pins it. A live
run that teaches something new adds a row there in the same commit as the fix.

**Giving the demo.** [`docs/walkthrough.md`](docs/walkthrough.md) walks the ERP screen by screen
along the twenty-minute path, then Commerce from the other side, and closes with one table per
business concept saying which screen on each side holds it and what joins them (the printable
twin of the planned Mapping view, AB-26m).

## Inputs

| Variable | What |
|---|---|
| `ERP_BASE_URL` | the ERP's web-action base (`…/api/v1/web/demo-erp`); Demo Builder writes it from the ERP component's deployed URLs |
| `ERP_DISPLAY_NAME` | what the first ERP is called: in history rows, the trace, the order prefix and wherever a value names that ERP |
| `INTEGRATION_DISPLAY_NAME` | the integration's own name: Commerce Admin's menu entry, the page title and the App Management app (default "ERP Integration"). Read when the app is built, so a new name reaches Commerce on the next deploy. The order grid's column ("ERP order") and the product action ("Move stock between ERP warehouses") name no ERP |
| `AIO_COMMERCE_AUTH_IMS_*` | the server-to-server credential the deploy injects; it authenticates calls to Commerce and to the ERP in the integration's own workspace (the ERP's actions are `require-adobe-auth`). An ERP in another workspace is called with its own credential, from the ERP list |

## Code layout

Laid out the way a customer would build an integration for several ERPs (the several-ERPs
design, v1). Adobe's starter-kit actions stay where the kit puts them
(`src/commerce-extensibility-1/actions/<entity>/commerce|external/`); four pieces sit beside them:

| Piece | Where | What it is |
|---|---|---|
| The router | `src/router/route-order.js` | Where a placed order goes first. It knows no ERP: it reads the ERP list, gives each line to the ERP that owns its product, and hands each ERP only its lines through that ERP's adapter. With one ERP it passes the whole order through, exactly as before. With several, a product's owner is the ERP whose id its `erp_owner` attribute holds (or the ERP's own ownership setting; an ERP owning by website takes every line of an order from one of its websites that no product-rule ERP owns); a line no ERP owns is held back, and a line two ERPs claim is a setup error sent to neither |
| The order's parts | `src/lib/order-parts.js` | One record per order in App Builder State (`order-parts-<order number>`): each ERP's part, what happened to it, and the lines held back. A redelivered order event sends only the parts that did not reach their ERP |
| Outcomes and the combined status | `src/router/part-outcomes.js`, `src/router/combined-status.js` | Each ERP message (hold, release, cancel, shipment, invoice, status) is matched to its part: the ERP the message names, else the one part holding its ERP sales order number. The ERP's adapter reads it into the part's outcome, the order's history gets one line under the ERP's name, and the router writes the combined status, the only writer of it (revised by the owner 2026-09-28): Commerce's On Hold only while EVERY part waits (held, failed, canceled by its ERP, or a line that reached no ERP or two), because Commerce will not ship or invoice an order On Hold; while SOME parts wait and others move, the order keeps its state with the custom status Partially Held (`partially_held`, a setup step in docs/demo-setup.md; if Commerce refuses it the note is written alone) and a note naming the waiting ERP; when the last waiting part is released the status returns to the state's own; Pending until every part is sent; Processing while parts move; Complete is Commerce's own. The order is never canceled automatically, and with several ERPs the whole order is not invoiced (each part's partial invoice is the next slice). ERP numbers live in the history and the parts record; the one ERP-number field on the order (`ext_order_id`) is written only when there is one ERP. With one ERP none of this runs: the messages act on the whole order exactly as before |
| Ownership | `src/router/ownership.js` | The one place that says which ERP owns a product; the router, contract prices and the product delete's Activity record all ask it |
| The order's parts, for staff | `src/lib/order-parts-view.js`, `erp/order-parts`, `admin-ui/order-grid` | Sales > Orders gains an **ERP parts** column ("2 of 2 sent", "1 held", plus lines that reached no ERP or two), read from the parts record; an order the router never split has no cell. The order page gains an **ERP parts** button (`adminUi.order.viewButtons`, page `#/order-parts`): one row per ERP's part with its lines, status (sent, held, failed, canceled…), ERP number, why it waits and any setup warning. With one ERP and no parts record (a guest's order), the page shows the whole order as its one part, from the order's history. `npm run preview`, then `?page=order-parts`, shows it |
| Re-send one part | `src/router/resend-part.js`, `erp/resend-part` | The parts page's **Re-send**, on a held or failed part: `POST { incrementId, erpId }` sends only that part again, through its ERP's adapter, with only its lines, then writes the combined status again. Idempotent by order and part: a part already with its ERP is answered as done, a part still being sent is refused (409), and a part a block holds waits (409) while the ERP still blocks the company. The whole-order row of a one-ERP order uses the existing Retry (`erp/history`) |
| Variant check | `src/router/route-order.js` | With several ERPs, a configurable line's variants are read (`GET products` by id, `GET configurable-products/{sku}/children`) and their owners asked. Variants owned by different ERPs are a setup mistake: the part the ordered variant went to records a warning, shown on the parts page. The order is never held for it, and a check that cannot read the variants is logged and skipped |
| Product delete, recorded | `product-commerce/deleted`, `src/lib/history.js` | A product deleted in Commerce is recorded in the Activity and no ERP is called: an ERP's product is not deleted because the web shop dropped it, and the next reset refills the ERP without it. Products pair by SKU, so there is no key-map row to unlink. With several ERPs the record names the ERP that owned the product, by the ownership rule; the product is gone from Commerce by then, so the delete event carries `erp_owner`, and an event without it names no ERP. A click on the row opens the product's look-up, which shows whether an ERP still holds it |
| Every call reaches the record's own ERP | `src/router/erp-params.js`, `src/router/part-changes.js`, `src/router/order-holders.js` | With several ERPs, a call about one record goes to the ERP that owns it, at its own address and signed with its own credential (`paramsForErp`). A product event is read back from the ERP it names (`erpId`; none is the first ERP while it is listed); a stock event names no ERP, so each SKU is read back from the ERP that owns the product. A product created or updated in Commerce, a stock item saved there and a grid stock move go to the product's owner (none when no single ERP owns it). A cancel, hold or release made in Commerce on a split order goes to every ERP holding an open part, each about its own sales order. The order trace asks each ERP holding the order. Detach reads every listed ERP's orders, since it undoes the whole integration. With one ERP every call is as before |
| Several ERPs in the page header | `erp/status`, `integration-page.jsx` | With several ERPs, `erp/status` also answers `erps: [{ id, name, reachable, error?, counts?, lastImportAt?, lastWipeAt? }]`, each asked at its own address, and the Admin page header names each ERP with whether it can be used and why not (its maintenance window, or "the ERP answered 401"). The Overview shows one row per ERP with its own figures. With one ERP the answer and the header are unchanged (`?one-erp` in the preview) |
| The rest of the Admin page per ERP | `erp/history`, `admin-ui/order-grid`, `erp/move-stock`, `src/lib/scheduled-runs.js` | With several ERPs: each History entry names its ERPs (an ERP event by its `erpId`, an order by its parts; derived when read, so older records are named too), and `?erp=<id>` with the page's ERP picker shows one ERP's; the order trace shows a split order's send as one step per part, each naming its ERP and why it waits, and an ERP event that came back names its ERP; the Look-up names a product's owning ERP and shows a company in each ERP; the orders grid's ERP column shows each part's ERP and number ("Split: Northwind ERP 0000001000; Contoso ERP waiting"), since a split order has no single ERP number; Move stock says which ERP was told which products and which product no ERP owns. The scheduled price publish records each run, read by `erp/history?scheduled=true`. The menu title and the app carry the integration's own name, and the grid column's label and the Move stock action's label name no ERP; all are set when the app is deployed. With one ERP everything is as before |
| Contract prices per ERP | `src/lib/contract-prices.js` | Each ERP writes and removes only the tier prices of the SKUs it alone owns, for the company the key map pairs with its customer; its ledger entries carry its id, so one ERP's prices never replace another's. With one ERP it owns every SKU |
| The Admin lookup per ERP | `erp/lookup` | With several ERPs a company is shown as it stands in each ERP (its customer there, from the key map, asked at that ERP's address), answered as `erps: [one lookup per ERP]`, and a SKU is shown in the ERP that owns it (`owner`). With one ERP the answer is unchanged |
| Shipments and invoices per part | `src/router/part-fulfilment.js`, `lockOrder` in `src/lib/order-parts.js` | With several ERPs each ERP invoices and ships only its own lines. An ERP's invoice becomes a partial Commerce invoice of its part's lines (`items[]`), never the whole order; its shipment carries only its part's lines and invoices them first if they are not yet (Commerce ships only what is invoiced). Partial invoices on one order run one at a time under the order's lock in App Builder State (Adobe patch MDVA-40399 reports simultaneous partial invoices failing; reported, not re-verified): a taker writes its token and reads it back, waits while another holds it, and answers 503 if it stays taken, so I/O Events delivers the invoice again rather than losing it. The part record keeps what each line has had invoiced and shipped, so a redelivered message invoices nothing twice. A shipment or invoice made in Commerce tells each ERP only its own lines, at its own address; the Invoice Saved event names no lines, so an invoice's are read from Commerce (`GET invoices/{id}`), and an invoice or shipment with no line of an ERP's part is never told to that ERP. An ERP invoice or shipment that names no line of its own part is refused, never read as the whole order. With one ERP everything is as before (whole-order invoice) |
| Per-ERP settings | `src/lib/erp-settings.js`, `erp/erps` | Settings that differ per ERP live on that ERP's entry in the ERP list: which products it owns, its order-number prefix, and its sales organization (per website if need be). Settings for the whole integration (send orders, hold when offline, the confirm status) stay in App Management's configuration. An entry's value wins; anything it does not set is the integration's configured value, so one ERP with no entry settings behaves exactly as before. On the Admin page, with several ERPs, the Settings section shows an ERP switcher beside the scope: "Every ERP" edits the integration's configuration, and picking an ERP edits only its own settings, showing what it does not set as inherited (`npm run preview`, then `?section=settings`, shows it with two stand-in ERPs). It saves with `PATCH erp/erps`; each part of a split order is sent with its ERP's settings for the order's website; `GET erp/settings?websites=...&erp=<id>` answers one ERP's view (Demo Builder's fill) |
| Credit blocks per ERP | `src/router/erp-blocks.js`, `src/lib/erp-blocks.js` | Each ERP for itself, with one ERP or several (owner, 2026-09-28): an ERP's **credit block** never changes the Commerce company's Active/Blocked switch, which is the **website account**, set only in Commerce and sent to each ERP as a read-only copy (`websiteAccountClosed`, contract version 5): it holds only that ERP's parts of the company's open orders (marked held by the block, the reason in each order's history; the order goes Partially Held, or On Hold if every part waits), and a new order's part for that ERP waits the same way instead of being sent, while the other ERPs' parts go. The unblock puts each part back as it was, or sends it if it never left. A part the ERP itself holds for credit is not the block's to release. The company's blocks and its open routed orders are kept in App Builder State. With one ERP its part is the whole order: a company's order is recorded as that ERP's one part and waits while the ERP blocks the company. Detach still undoes company-status entries an older version ledgered |
| Credit per ERP | `src/lib/erp-credit.js` | With several ERPs, an ERP's credit limit (and its exposure and available credit when it sends them) goes to company custom attributes prefixed by its id (`erp_<id>_credit_limit`, `erp_<id>_exposure`, `erp_<id>_available`), written whole with `POST company/setCustomAttributes` (the call may replace the set; that it does is unverified live), and Commerce's company credit limit becomes the total of the ERPs' limits. Both writes are ledgered with the ERP that made them, so detach puts the attributes and the limit back; detach of one ERP takes only that ERP's attributes off and sets the limit to the total the other ERPs hold. In the demo the ERPs own credit limits; a customer whose CRM owns them would not write the limit here. With one ERP, as before |
| The contract | `src/adapters/contract.js` | The two functions every adapter implements: `sendPart` (send this ERP its part) and `readOutcome` (turn the ERP's message into the part's outcome) |
| The adapters | `src/adapters/<kind>/` | One folder per KIND of ERP. `demo-erp/` talks to the demo ERP; `example/` is a commented skeleton showing what adding another kind takes |
| The ERP list | `src/lib/erps.js`, `erp/erps` | One entry per ERP: an `id` that never changes (the key for everything), a `name` for people, its adapter kind, and its connection. Demo Builder stores the list in App Builder State when an SC adds or removes an ERP (`PUT erp/erps`, checked: unique ids and names, a known adapter kind, an https address). With nothing stored, the list is one ERP, id `erp`, from the deployed settings, so a single-ERP install works exactly as before. Each ERP names itself on the events it sends (`erpId`, contract version 4) when it was deployed with an `ERP_ID` |

A company buying from several ERPs is a customer in each: the key map pairs it once per ERP (`erpId` on each entry; an entry without it is the single ERP's), a company saved in Commerce goes to every ERP, and each ERP's part of an order names the buyer by that ERP's customer number.

Each ERP outside the integration's workspace is signed in to with its own server-to-server credential: an ERP's actions are `require-adobe-auth`, which accepts machine calls only from its own workspace's technical account. Demo Builder hands the credential over with the ERP's list entry when it adds the ERP (`connection.auth`: `clientId`, `clientSecret`, `orgId`, `scopes`, and optionally the technical account), and every call to that ERP is signed with it (`paramsForErp`, `src/lib/erp-auth.js`). The first ERP, in the integration's own workspace, has none and uses the integration's credential. The credential is kept in the ERP list in App Builder State and never returned: `GET erp/erps` and every other answer show only `{ clientId, orgId, hasSecret }`. A `PUT erp/erps` that leaves an ERP's `auth` out keeps the stored one, and `auth: null` clears it. Removing the ERP from the list removes its credential; deleting its workspace revokes it.

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

Apache-2.0. The scaffolding is the starter kit's, which is Adobe's under the same license
(see COPYRIGHT).
