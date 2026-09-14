# commerce-erp-integration

The Adobe Commerce half of Demo Builder's ERP integration, built on Adobe's
[Commerce integration starter kit](https://github.com/adobe/commerce-integration-starter-kit)
(App Management generation). Its other half is the ERP itself,
[skukla/demo-erp](https://github.com/skukla/demo-erp), a mock SAP-style system deployed in
the same App Builder workspace. Demo Builder installs and removes the two as a unit.

## What it does

| Direction | How | Where |
|---|---|---|
| Order → ERP | `observer.sales_order_place_before` webhook creates the sales order in the ERP and writes the ERP number onto the order as `ext_order_id` | `webhook/order-create` |
| Contract prices → cart | totals-collector `item_prices` webhook replaces each line's price with the ERP's contract price for the buyer's business partner | `webhook/item-prices` |
| Discount ceiling → cart | totals-collector `execute` webhook claws back discount below the ERP's maximum-discount ceiling | `webhook/discounts` |
| Products → ERP | product created/updated events keep the ERP's materials in step | `product-commerce/*` |
| ERP → Commerce | every minute (alarm trigger) and on demand, `erp/drain` pulls the ERP's outbox: list price → product price, stock → source item, credit limit and block → company, order status → comment / shipment / invoice / cancel. Company writes are ledgered. | `erp/drain` |
| Reset | revert the ledgered company writes → wipe the ERP → mirror Commerce (products, stock, companies) into it again | `erp/reset` |
| Mirror | the import half of reset, run at first install | `erp/mirror` |
| Outage demo | `erp/set-offline` flips the ERP's offline switch; the webhooks then answer "success" and Commerce keeps its own prices | `erp/set-offline` |
| Commerce Admin screen | System → ERP integration (Admin UI SDK): health, counts, the four controls, a log | `src/commerce-backend-ui-2` |

All three webhooks are `required: false` with short soft timeouts on purpose: an ERP that is
slow or away never breaks a cart or an order.

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
