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
| `GET products` (`entity_id` filter) | `lib/commerce.js skuForProductId`, `skusForProductIds` | stock event → SKU; move stock → SKUs | used today |
| `GET products` (pages), `GET products/attributes`, `GET store/storeConfigs` | removed from this app 2026-09-27 | the ERP fill | Demo Builder makes these reads now (its `erpFillReaders.ts`) |
| `PUT products/{sku}` (`product.name`, `product.price`) | `setProductName`, `setProductPrice`; kit `updateProduct` | ERP price/name → Commerce; revert | used today |
| `POST products`, `DELETE products/{sku}` | kit `createProduct`, `deleteProduct` | kit scaffolding; not called by our flows | present, unused |
| `GET inventory/source-items` (`sku` filter) | `warehousesOfSku`, `sourceCodesOf` | a product's stock at every source, sent on the product and stock events and after a move | used today |
| `POST inventory/source-items` | `setStock`; kit stock client | ERP stock → Commerce; revert | used today |
| `GET inventory/sources` (404-tolerant) | `listSources` | source names → warehouse names | used today |
| `GET company/{id}` | `readCompanyRow`, `getCompany` | company event → partner; block handler | used today |
| `PUT company/{id}` (`company.status`) | `setCompanyStatus` | block/unblock; revert | used today |
| `GET companyCredits/company/{id}` | `readCompanyRow`, `getCompanyCredit` | credit limit | used today |
| `PUT companyCredits/{creditId}` | `setCompanyCreditLimit` | ERP limit → Commerce; revert | used today |
| `GET orders` (`increment_id` filter), `GET orders/{id}` | `getOrderByIncrementId`, kit `getOrder` | order save event → entity id | used today |
| `GET sharedCatalog` (`customer_group_id` filter), `GET customerGroups/{id}` | `lib/commerce-tier-prices.js sharedCatalogGroupOf` | a company's custom shared catalog group, and its code | read live 2026-09-28 (Bodea, captured in `test/fixtures/commerce/`); code added (AB-26z) |
| `POST products/tier-prices`, `POST products/tier-prices-delete`, `POST products/tier-prices-information` | `writeTierPrices`, `deleteTierPrices`, `tierPricesOf`, `revertTierPrice` | ERP contract prices → the company's shared catalog; revert | bodies from Adobe's "Manage prices for multiple products"; the information read was measured 2026-09-26; the writes are not yet run live (AB-26z Z5) |
| `POST orders` (sparse: `entity.entity_id` + `ext_order_id`) | `setExtOrderId`, `clearExtOrderId` | ERP number write-back; clear on detach | used today |
| `POST orders/{id}/comments` (`statusHistory` ± `status`) | `orders.comment`, kit `addComment` | notes; a custom status on confirm (a comment sets only a status of the order's current state) | used today |
| `POST orders/{id}/cancel` | `orders.cancel`, kit `cancelOrder` | ERP cancel; a reset's close (AB-16n), which reads the `false` Commerce answers when it cannot cancel | used today |
| `POST order/{id}/ship` (`items[]`, `comment`, `notify`, `arguments.extension_attributes.source_code`) | kit shipment client | ERP shipment, per-item, per source | used today (`source_code` path: kit transformer — confirm the live response records the source) |
| `POST order/{id}/invoice` (`capture: true`, `notify: false`) | `orders.invoice`, kit `invoiceOrder` | ERP invoice, whole order | used today |
| `POST shipment` | kit `updateShipment` | kit scaffolding | present, unused |

## REST — calls later slices need (to validate before the slice starts)

| Call | Slice | Purpose | Status |
|---|---|---|---|
| `POST orders/{id}/hold`, `POST orders/{id}/unhold` | AB-26f | credit hold ↔ Commerce On Hold; detach unholds | **proven live 2026-09-27**: both answer `true`; the ERP's hold put order 3000000013 On Hold and its release took it off |
| `GET shipments/{id}` or the shipment event payload's items (`order_item_id`, `qty`, `extension_attributes.source_code`) | AB-26g | Commerce-side shipment → ERP shipment | **proven live 2026-09-27** (a partial shipment and the rest reached the ERP); `shipments-order-11.json` |
| `GET invoices/{id}` or the invoice event payload | AB-26g | Commerce-side invoice → ERP invoice | **proven live 2026-09-27**; `invoices-order-11.json` |
| `GET store/websites`, `GET store/storeGroups`, `GET store/storeViews`, `GET store/storeConfigs` | AB-26j | website list; `store_id` → website; currency per website | websites captured (`websites.json`, read by `listWebsites`); store configs are read by Demo Builder's fill now |
| Store Information and shipping Origin config values (address, VAT) per website | AB-26j | company code identity on the Organization card | **open**: no REST endpoint is documented for reading `general/store_information/*`; candidates are the store configs payload or a config read through App Management — decide after a live look |
| `GET company/{id}` fields `legal_name`, `vat_tax_id`, `reseller_id`, `street`, `city`, `region`, `postcode`, `country_id`, `telephone`, `super_user_id` | AB-26j | the buyer's legal identity | captured: `company-21.json` (read by `readCompanyRow`) |
| `GET customers/{id}` → `website_id` | AB-26j | the company admin's website → sales organization | captured: `customer-44.json` (`website_id` and `extension_attributes.company_attributes.company_id`) |
| MSI source-item change event, or `GET inventory/source-items` for changed SKUs | AB-26h | per-source stock changes → ERP | **settled 2026-09-27**: no event fired for a quantity written through REST, not even the legacy stock one; the minute refresh that carried it was removed 2026-09-27; a move between the ERP's warehouses goes through this app's Move stock mass action, which tells the ERP (`source-items-accessmesh.json`) |
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
| `observer.sales_order_shipment_save_after` | yes | AB-26g | **proven live 2026-09-27**; payload not captured (a successful delivery leaves no Runtime record) |
| `observer.sales_order_invoice_save_after` | yes | AB-26g | **proven live 2026-09-27**; payload not captured |
| order hold/unhold/cancel: the order save event's non-new saves | yes | AB-26g | **proven live 2026-09-27**: hold, unhold and cancel in Commerce each reached the ERP |
| `observer.sales_order_creditmemo_save_after` | no | AB-26r | to validate |
| `observer.catalog_product_delete_commit_after` | yes | AB-26h (G1), AB-26y step 5 | proven live 2026-09-27 as it then was (the product left the ERP). Since AB-26y step 5 the delete is only recorded in the Activity and the ERP keeps the product; not yet run live |
| `observer.company_save_commit_after` (B2B) | yes | — | in Commerce's supported event list (`GET eventing/supportedList`); replaces the removed minute refresh; not yet proven live |

Changing a subscription after install needs an uninstall + install of the app in Commerce
(README). Every "to validate" event is therefore proved in the scratch workspace first.

## Webhooks

| Webhook | Plugin hook | Status |
|---|---|---|
| `erp_contract_price`, `erp_discount_ceiling` (totals collector `item_prices`, `execute`) | removed in 0.9.0 (AB-26z): contract prices are synced into shared catalogs, and no ERP is asked on a cart change | removed |
| availability check at add-to-cart / order placement (`required: true`) | AB-19 | to validate the plugin hook name |
| credit check at order placement (`required: true`) | AB-20 | to validate |

## Admin UI SDK and App Management

| Feature | Used | Slice | Status |
|---|---|---|---|
| `adminUi.menu` under Apps, no parent menu set (extension point `commerce/backend-ui/2`) | yes | — | used today |
| `businessConfig` schema → App Management form, per-scope values (`@adobe/aio-commerce-lib-config`) | yes (five booleans) | AB-26j adds `text`/`list` fields | text-type rendering **to validate** (a person looks at the form once) |
| Order grid columns, order view buttons, mass actions (Admin UI SDK v2 order extension points) | no | AB-26m | to validate on the target backend |

## The ERP side — the contract

`contract/erp-contract.json` (vendored from `skukla/demo-erp`) is at `contractVersion` 2
since 2026-09-24, which added the business-structure fields. It still lists routes,
import/quote/order KEY lists and event payload keys, not full request/response shapes;
full shapes were dropped (owner, 2026-09-27): the pair-in-a-box journeys run the real ERP
code against this app, and they now refuse an ERP checkout whose contract differs from
this repo's copy, so the two cannot drift without a failing test. `test/contract/
erp-contract.test.js` here and `test/contract.test.js` there pin it; `npm run
contract:check` reports when the vendored copy is behind.

## Live validation — status

Run 2026-09-27 on the Bodea sandbox through Demo Builder's agent tools (every write was a test
order, a test product or a value put back afterwards). The answers the integration reads are
captured under `test/fixtures/commerce/`, with contact details, hostnames and the tenant id
replaced, and `test/contract/commerce-fixtures.test.js` runs the real readers over them.

| Fixture | Request | Read by |
|---|---|---|
| `products-page.json` | `GET products` | `listProducts` |
| `source-items-accessmesh.json` | `GET inventory/source-items` (one SKU) | `listStock`, `sourceCodesOf` |
| `sources.json` | `GET inventory/sources` | `listSources` |
| `stocks.json`, `stock-source-links.json` | `GET inventory/stocks`, `GET inventory/stock-source-links` (needs `searchCriteria`) | Demo Builder's second-source setup check |
| `companies-page.json`, `company-21.json` | `GET company`, `GET company/{id}` | `listCompanies` |
| `company-credit-21.json` | `GET companyCredits/company/{id}` | `listCompanies` |
| `customer-44.json` | `GET customers/{id}` | `listCompanies` (admin website), `customerCompanyId` |
| `orders-by-increment.json`, `order-11.json` | `GET orders?…increment_id`, `GET orders/{id}` | `findOrderByIncrementId`, `unholdIfHeld`, `cancellableByReset`, `hasResetNote` |
| `shipments-order-11.json`, `invoices-order-11.json` | `GET shipments`, `GET invoices` (by order) | the shape of what Commerce-side shipments and invoices carry |
| `websites.json`, `store-configs.json` | `GET store/websites`, `GET store/storeConfigs` | `listWebsites`, `storeConfigs` |

Not captured: the payloads of Commerce's own events. Runtime keeps no record of a successful
delivery, so the only place to read one is the event registration's debug tracing in the
Developer Console. The handlers that read them are proven by what they did, not by a fixture.
