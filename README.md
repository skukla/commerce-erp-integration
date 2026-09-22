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
| Order → ERP | the order save event (`observer.sales_order_save_commit_after`), as Adobe's integration starter kit does it: a new order is created in the ERP and the ERP number written back as `ext_order_id`, with a note on the order. While the ERP cannot take it, the website's *Hold orders while the ERP is offline* setting decides: on, I/O Events delivers again for up to a day; off, the order is not sent | `order-commerce/created` |
| Contract prices → cart | totals-collector `item_prices` webhook replaces each line's price with the ERP's contract price for the buyer's business partner | `webhook/item-prices` |
| Discount ceiling → cart | totals-collector `execute` webhook claws back discount below the ERP's maximum-discount ceiling | `webhook/discounts` |
| Products → ERP | product created/updated and stock events keep the ERP's products in step; companies are refreshed from Commerce every minute | `product-commerce/*`, `stock-commerce/updated`, `erp/refresh-partners` |
| ERP → Commerce | the ERP publishes its events to the ingestion webhook; they are published to Adobe I/O Events and the handlers apply them: price → product, stock → source item, credit limit and block → company (ledgered), order status → comment / shipment / invoice / cancel | `ingestion/webhook`, `*-backoffice/*` |
| Reset | undo what was written onto Commerce (ledgered company writes; the ERP number on every ERP-numbered order) → wipe the ERP → mirror Commerce (products, stock, companies) into it again | `erp/reset` |
| Detach | the first half of reset alone: undo the company writes and clear the ERP numbers, leaving the ERP untouched. Demo Builder runs it before removing the integration | `erp/detach` |
| Mirror | the import half of reset, run at first install | `erp/mirror` |
| Settings | per website or store view, kept by App Management's business configuration: send orders, hold orders while offline, mark Processing on confirm, contract prices, discount ceiling | `erp/settings`, `src/lib/settings.js` |
| History and Retry | one record per order sent to the ERP — sent, waiting for the ERP, or not sent — with the number of tries, kept 14 days in App Builder State (`src/lib/history.js`). A person can send one again from the Admin screen: it goes through the same send, as new, and the website's settings still apply | `erp/history` |
| Commerce Admin screen | System → ERP integration (Admin UI SDK): health, counts, the four controls, the orders sent to the ERP with a Retry on any that did not get through, a log of this visit's actions | `src/commerce-backend-ui-2` |

Both cart webhooks are `required: false` with short soft timeouts on purpose: an ERP that is
slow or away never breaks a cart. Orders are never held up at checkout: they reach the ERP
after they are saved.

**Changing a webhook or event after install.** App Management's installer skips a webhook that
is already subscribed and never updates it, and uninstall removes only what the current config
lists. So a changed `required`, timeout or field list, a new event, or a removed webhook reaches
Commerce only through an uninstall run with the old config, then an install with the new one.

**Who is the master.** The SC prepares the demo in Commerce, so Commerce is the master and
the ERP adapts to it: every product, stock and company change in Commerce overwrites the
ERP's copy (events for products and stock, the partner refresh every minute, the mirror at
install and reset). On stage the ERP looks like the system of record: an edit on its screen
is published as an ERP event, applied to Commerce here, and comes back on the next import as
the same value.
Reset returns the ERP to a fresh mirror of Commerce.

## APIs and events, in one place

**Commerce → this app**

| Kind | Name | Handler |
|---|---|---|
| webhook (totals collector) | `plugin.out_of_process_totals_collector.api.get_total_modifications.item_prices` | `webhook/item-prices` → ERP `POST pricing/quote`, answers `replace result/price_updates` |
| webhook (totals collector) | `plugin.out_of_process_totals_collector.api.get_total_modifications.execute` | `webhook/discounts` → ERP `POST pricing/quote`, answers `replace result` (negative `base_discount`) |
| event | `observer.catalog_product_save_commit_after` | `product-commerce/created`, `product-commerce/updated` → ERP `POST admin/import` |
| event | `observer.sales_order_save_commit_after` | `order-commerce/created` → Commerce `GET orders` (entity by increment id) → ERP `POST orders` → Commerce `POST orders` (`ext_order_id`) and `POST orders/{id}/comments` |
| event | `observer.cataloginventory_stock_item_save_commit_after` | `stock-commerce/updated` → Commerce `GET products` (SKU by id) → ERP `POST admin/import` |

**ERP → this app** (the ERP posts to `ingestion/webhook`, published to the `erp` provider)

| ERP event | Handler | Commerce REST call |
|---|---|---|
| `be-observer.catalog_product_update` | `product-backoffice/updated` | `PUT products/{sku}` (name, price) |
| `be-observer.catalog_stock_update` | `stock-backoffice/updated` | `POST inventory/source-items` |
| `be-observer.sales_order_status_update` | `order-backoffice/updated` | `POST orders/{id}/comments` |
| `be-observer.sales_order_shipment_create` | `order-backoffice/shipment-created` | `POST order/{id}/ship` |
| `be-observer.sales_order_invoice_create` | `order-backoffice/invoice-created` | `POST order/{id}/invoice`, `POST orders/{id}/comments` |
| `be-observer.sales_order_cancel` | `order-backoffice/cancelled` | `POST orders/{id}/cancel` |
| `be-observer.company_credit_update` | `company-backoffice/credit-updated` | `GET companyCredits/company/{id}`, `PUT companyCredits/{id}` (ledgered) |
| `be-observer.company_status_update` | `company-backoffice/status-updated` | `GET company/{id}`, `PUT company/{id}` (ledgered) |

**This app → Commerce, on its own** (mirror, reset, detach, the minute refresh): `GET products`,
`GET inventory/source-items`, `GET company`, `GET companyCredits/company/{id}`; reset and detach
also revert ledgered `PUT companyCredits/{id}` and `PUT company/{id}` and clear `ext_order_id`
with a sparse `POST orders` (entity id + the one field) on every order the ERP numbered.

**This app → the ERP**: `GET health`, `GET/PATCH settings`, `POST admin/wipe`,
`POST admin/import`, `POST pricing/quote`, `POST orders`, `GET orders`.

**The pin.** [`contract/erp-contract.json`](contract/erp-contract.json) is the ERP's own
contract, vendored. `test/contract/erp-contract.test.js` fails when this app subscribes to an
event the ERP does not raise, handles keys it does not send, or calls a route it does not
serve. `npm run contract:check` fetches the ERP's current contract and says when the vendored
copy is behind.

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
Admin screen registration). Demo Builder drives that install; by hand, use the app's
generated install API.

## Licence

Apache-2.0. The scaffolding is the starter kit's, which is Adobe's under the same licence
(see COPYRIGHT).
