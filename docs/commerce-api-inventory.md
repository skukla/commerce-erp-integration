# Commerce API inventory — every call the ERP programme needs, and whether it is proven

Started 2026-09-24 (backlog AB-26b). One row per API. "Used today" means the deployed
integration already makes the call and it works against the demo instance — that is the
strongest evidence there is. "To validate" means a later slice needs it and no code calls it
yet: it gets a read-only live call and a captured fixture in `test/fixtures/commerce/`
before that slice starts. A fixture captured live is the contract; a shape typed from memory
is not.

**Target backend.** The demo runs on Adobe Commerce as a Cloud Service (the owner confirmed
MSI is in the ACCS backend, 2026-09-23). ACCS and PaaS are not guaranteed identical, so
"exists" below means "answered on the instance this pair is installed against" unless a
row says otherwise.

## REST — calls the integration makes today

| Call | Where | Why | Status |
|---|---|---|---|
| `GET products` (searchCriteria pages; `entity_id` filter for one) | `lib/commerce.js listProducts`, `skuForProductId` | mirror; stock event → SKU | used today |
| `GET products/attributes` (`attribute_id in`) | `listVariantAttributes` | variant labels | used today |
| `PUT products/{sku}` (`product.name`, `product.price`) | `setProductName`, `setProductPrice`; kit `updateProduct` | ERP price/name → Commerce; revert | used today |
| `POST products`, `DELETE products/{sku}` | kit `createProduct`, `deleteProduct` | kit scaffolding; not called by our flows | present, unused |
| `GET inventory/source-items` | `listStock` | mirror stock per source | used today |
| `POST inventory/source-items` | `setStock`; kit stock client | ERP stock → Commerce; revert | used today |
| `GET inventory/sources` (404-tolerant) | `listSources` | source names → warehouse names | used today |
| `GET company` (pages), `GET company/{id}` | `listCompanies`, `getCompany` | mirror partners; block handler | used today |
| `PUT company/{id}` (`company.status`) | `setCompanyStatus` | block/unblock; revert | used today |
| `GET companyCredits/company/{id}` | `listCompanies`, `getCompanyCredit` | credit limit | used today |
| `PUT companyCredits/{creditId}` | `setCompanyCreditLimit` | ERP limit → Commerce; revert | used today |
| `GET orders` (`increment_id` filter), `GET orders/{id}` | `getOrderByIncrementId`, kit `getOrder` | order save event → entity id | used today |
| `POST orders` (sparse: `entity.entity_id` + `ext_order_id`) | `setExtOrderId`, `clearExtOrderId` | ERP number write-back; clear on detach | used today |
| `POST orders/{id}/comments` (`statusHistory` ± `status`) | `orders.comment`, kit `addComment` | notes; a custom status on confirm (a comment sets only a status of the order's current state) | used today |
| `POST orders/{id}/cancel` | `orders.cancel`, kit `cancelOrder` | ERP cancel | used today |
| `POST order/{id}/ship` (`items[]`, `comment`, `notify`, `arguments.extension_attributes.source_code`) | kit shipment client | ERP shipment, per-item, per source | used today (`source_code` path: kit transformer — confirm the live response records the source) |
| `POST order/{id}/invoice` (`capture: true`, `notify: false`) | `orders.invoice`, kit `invoiceOrder` | ERP invoice, whole order | used today |
| `POST shipment` | kit `updateShipment` | kit scaffolding | present, unused |

## REST — calls later slices need (to validate before the slice starts)

| Call | Slice | Purpose | Status |
|---|---|---|---|
| `POST orders/{id}/hold`, `POST orders/{id}/unhold` | AB-26f | credit hold ↔ Commerce On Hold; detach unholds | to validate |
| `GET shipments/{id}` or the shipment event payload's items (`order_item_id`, `qty`, `extension_attributes.source_code`) | AB-26g | Commerce-side shipment → ERP shipment | to validate |
| `GET invoices/{id}` or the invoice event payload | AB-26g | Commerce-side invoice → ERP invoice | to validate |
| `GET store/websites`, `GET store/storeGroups`, `GET store/storeViews`, `GET store/storeConfigs` | AB-26j | website list; `store_id` → website; currency per website | to validate (the endpoints are named in the REST quick reference; field shapes not yet read) |
| Store Information and shipping Origin config values (address, VAT) per website | AB-26j | company code identity on the Organisation card | **open**: no REST endpoint is documented for reading `general/store_information/*`; candidates are the store configs payload or a config read through App Management — decide after a live look |
| `GET company/{id}` fields `legal_name`, `vat_tax_id`, `reseller_id`, `street`, `city`, `region`, `postcode`, `country_id`, `telephone`, `super_user_id` | AB-26j | the buyer's legal identity | documented (company object, read 2026-09-24); fixture pending |
| `GET customers/{id}` → `website_id` | AB-26j | the company admin's website → sales organisation | documented (customer object); fixture pending |
| MSI source-item change event, or `GET inventory/source-items` for changed SKUs | AB-26h | per-source stock changes → ERP | **open**: no Commerce event for source items is confirmed; fallback is the minute refresh re-reading source items |
| `POST order/{id}/refund` or `POST orders/{id}/refund` (credit memo) | AB-26r | credit memo | to validate |
| `GET transactions` / invoice `state` (paid) | AB-26s | payment captured → ERP incoming payment | to validate |
| company credit balance operations (increase / decrease / reimburse) | AB-26s | ERP payment → company balance | to validate — exact paths to be read from the live instance's REST schema, never typed from memory |
| custom order attributes on the order (ACCS only: code + value pairs shown on the Admin order view; created via GraphQL or the Admin; editable only while the order is Pending) | AB-26t (Q-num) | one attribute per ERP number when two ERPs share an order | **to validate**: the write path over REST (extension/custom attributes on `POST orders`) or GraphQL; whether the Pending-only rule holds for an API write after the order leaves Pending. Owner asked for this 2026-09-24; Experience League order-processing page and ACCS release notes name the feature |

## Commerce events

| Event | Subscribed | Slice | Status |
|---|---|---|---|
| `observer.catalog_product_save_commit_after` | yes | — | used today |
| `observer.sales_order_save_commit_after` (`_isNew`, `store_id`, items) | yes | — | used today |
| `observer.cataloginventory_stock_item_save_commit_after` | yes | — | used today; **default source only** (legacy stock item) |
| `observer.sales_order_shipment_save_commit_after` (or `_save_after`) | no | AB-26g | to validate: exact name and payload fields on the target backend |
| `observer.sales_order_invoice_save_commit_after` | no | AB-26g | to validate |
| order hold/unhold: the order save event with `state` = `holded` | no (the handler skips non-new saves) | AB-26g | to validate that the save event fires on hold and carries `state` |
| `observer.sales_order_creditmemo_save_after` | no | AB-26r | to validate |
| product delete event | no | AB-26h (G1) | to validate whether one exists |
| company save event (B2B) | no | — (the minute refresh covers it) | to validate whether one exists; would replace polling |

Changing a subscription after install needs an uninstall + install of the app in Commerce
(README). Every "to validate" event is therefore proved in the scratch workspace first.

## Webhooks

| Webhook | Plugin hook | Status |
|---|---|---|
| `erp_contract_price` | `plugin.out_of_process_totals_collector.api.get_total_modifications.item_prices` (`required: false`, 1s soft / 5s hard) | used today |
| `erp_discount_ceiling` | `…get_total_modifications.execute` | used today |
| availability check at add-to-cart / order placement (`required: true`) | AB-19 | to validate the plugin hook name |
| credit check at order placement (`required: true`) | AB-20 | to validate |

## Admin UI SDK and App Management

| Feature | Used | Slice | Status |
|---|---|---|---|
| `adminUi.menu` under System (extension point `commerce/backend-ui/2`) | yes | — | used today |
| `businessConfig` schema → App Management form, per-scope values (`@adobe/aio-commerce-lib-config`) | yes (five booleans) | AB-26j adds `text`/`list` fields | text-type rendering **to validate** (a person looks at the form once) |
| Order grid columns, order view buttons, mass actions (Admin UI SDK v2 order extension points) | no | AB-26m | to validate on the target backend |

## The ERP side — the mirror contract

`contract/erp-contract.json` (vendored from `skukla/demo-erp`, version 1 today) lists routes,
import/quote/order KEY lists and event payload keys. AB-26j step 01 takes it to version 2
with full request/response shapes; SAP's terms ride in descriptions (sold-to, sales
organisation, delivering plant) without renaming fields that work. `test/contract/
erp-contract.test.js` here and `test/contract.test.js` there pin it; `npm run
contract:check` reports when the vendored copy is behind.

## Live validation — status

Not yet run. Blocked 2026-09-24 on importing the deployed workspace's configuration into
this repo (`aio app use -g` answered `503 Service Unavailable` from Adobe's Console API,
`ERROR_GET_SERVICES_FOR_ORG … getOffers short-circuited`). Retry; the call is read-only and
inside the loop's rails. When it succeeds, each "to validate" row gets a read-only call,
a fixture, and a test.
