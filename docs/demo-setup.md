# Demo setup: what the Commerce instance needs for each ERP story

For the person preparing a demo. Three stories, each building on the one before. Every
requirement says where in the Commerce Admin it is set, how to prove it over the REST API
(the same calls the integration makes), and how to undo it. The ERP itself never needs
preparing: it is rebuilt from Commerce at install and on every Reset.

The API checks below are `GET` calls against `https://<your-instance>/rest/V1/...` with an
admin bearer token or the integration's own credential. They change nothing. Most are the
calls the integration itself makes; the few that are not (`inventory/stocks`,
`products/attributes/{code}`) are from the Commerce REST reference.

## Story 1: one ERP, one store

**Needs nothing beyond a store with products, and companies if you want B2B.** Every setting
has a default: orders are sent, the sales organisation is `1000`, every product belongs to
the ERP, ERP order numbers are prefixed with the first four letters of the ERP's name.

What to have, so there is something to show:

| Have | Where in Admin | Check | Undo |
|---|---|---|---|
| Products with stock | Catalog → Products | `GET products?searchCriteria[pageSize]=5` returns items | your usual catalog reset |
| At least one B2B company with a credit limit | Customers → Companies; the company's Credit tab | `GET company` lists it; `GET companyCredits/company/{id}` shows `credit_limit` | delete the company (Customers → Companies) |
| Each company in a customer group of its own (assign it a shared catalog, which gives it one) | Catalog → Shared Catalogs → Assign Companies | `GET company/{id}` shows a `customer_group_id` no other company has | assign the company back to the General group |
| Optional: a status that shows "confirmed in the ERP" on a pending order | Stores → Settings → Order Status → Create New Status (code `erp_confirmed`), then Assign Status to State: state Pending, NOT as default; put the code in the ERP settings' "Order status when the ERP confirms" | the order's Comments History shows the status after the ERP confirms | clear the setting; unassign the status |
| An order or two placed as a company user | the storefront | `GET orders?searchCriteria[pageSize]=5` | the integration's Reset clears the ERP's number from each order; Commerce cannot delete an order |

The customer group matters more than it looks. An order names its buyer's company, so the
ERP books it to the right account whatever the group. A cart does not: the pricing webhooks
carry only the customer group and the buyer's email, so a company left in the General group
(Commerce's default for every company) prices as the walk-in customer at cart time, and its
contract prices and discounts do not show until the order lands. Measured 2026-09-25 with
three companies sharing group 1.

A confirmation in the ERP cannot move a Commerce order to Processing. Adobe's documentation
(Experience League, "Order status" and "Order workflow and processing", read 2026-09-25):
states drive the workflow and are not visible; statuses communicate progress and "have no
impact on the order processing workflow"; an order leaves Pending when payment is received
(an invoice) or it ships; and a comment may set only a status of the order's current state,
custom ones included. So the ERP's confirmation lands as a note, plus the optional status
above, and Processing follows the invoice or shipment as Commerce requires.

## Story 2: the business structure (two websites as two sales organisations)

The ERP shows a company code (itself), sales organisations (one per Commerce website) and
warehouses (one per inventory source). With one website everything says `1000` and the story
is invisible. To show it, give Commerce a second website and tell the integration which sales
organisation sells through it.

| Have | Where in Admin | Check | Undo |
|---|---|---|---|
| A second website, with a store and a store view | Stores → Settings → All Stores → Create Website (then a store and a store view under it) | `GET store/websites` lists both codes; `GET store/storeConfigs` shows one row per store view with `website_id` and `base_currency_code` | Stores → All Stores → the website → Delete Web Site |
| A different base currency on the second website, if you want the invoice to say EUR | Stores → Configuration → General → Currency Setup, scope set to that website | `GET store/storeConfigs`: the second website's `base_currency_code` | set the scope back to Use Default |
| The sales organisation for each website | the integration's Admin screen (System → the ERP's name) → Mapping → the Selling organization card, scope picker set to the website: *ERP sales organisation for this website* (four letters or digits, `2000`) and *Sales organisation name* (`Online EU`) | the ERP's Settings → Organisation card lists both after a Reset; or `GET health` on the ERP and read `structure.salesOrgs` | set the field back to `1000` at that scope, or clear the website override |
| A company whose admin user belongs to the second website | Customers → Companies → the company → Company Admin; the admin's customer account must be on that website (Customers → All Customers → the account → Account Information → Associate to Website) | `GET company/{id}` gives `super_user_id`; `GET customers/{super_user_id}` gives `website_id` = the second website's id | move the customer back to the main website |
| An order from the second website | the storefront on the second website's URL | `GET orders/{id}` shows `store_id` of a store view under that website; in the ERP the order header prints `2000 · Online EU` | Reset (clears the ERP number; the Commerce order stays) |

What you will see after a Reset: the ERP's Settings → Organisation card prints
`1000 · <ERP name> · <currency> · <country>` and both sales organisations with their website
and counts. The customer document says which sales organisations the company is "Sold-to
in". The invoice's Seller card prints the sales organisation of the order.

What the ERP cannot show: Store Information (the seller's address and VAT number) is not
readable over Commerce's REST API, so the Organisation and Seller cards print the base
currency and locale from the store configuration and leave address and VAT blank. That is a
limit of the API, not of the demo setup.

Warehouse names: the ERP takes each inventory source's Commerce name the first time it sees
the code, and a person can rename it on the ERP's Settings → Warehouses card (`Plant 1000 ·
Seattle DC`). Commerce keeps its own source name. The ERP name survives Reset.

## Story 3: two ERPs on one store

Two copies of the ERP pair on one Commerce, each owning part of the catalog. Commerce tells
their orders apart by the prefix on the ERP number; each pair decides which products are its
own. Demo Builder deploys the second copy with its own app id (`erp-integration-2`); this
guide covers what Commerce needs.

Pick ONE way to split the catalog. **The product attribute is the story** (owner, 2026-09-24):
in a real deployment a PIM writes the owning system onto each product, and Commerce carries
it as an attribute; the demo sets that attribute in Commerce directly. Inventory sources
remain an alternative for a store whose warehouses already map one-to-one onto ERPs.

### 3a. Split by inventory source (alternative)

| Have | Where in Admin | Check | Undo |
|---|---|---|---|
| One inventory source per ERP (the default source can be one of them) | Stores → Inventory → Sources → Add New Source (code `east`, a name, an address) | `GET inventory/sources` lists the codes | Commerce cannot delete a source; disable it (Enabled: No) and unassign the products |
| Each product assigned to the source of the ERP that owns it, with a quantity | Catalog → Products → the product → Sources → Assign Sources | `GET inventory/source-items?searchCriteria[filter_groups][0][filters][0][field]=sku&searchCriteria[filter_groups][0][filters][0][value]=<sku>` lists the product's `source_code`s | unassign the source on the product |
| A stock that sells those sources on your website (so the storefront can sell them) | Stores → Inventory → Stocks | `GET inventory/stocks` | edit the stock's sources |
| On each pair: *Which products belong to this ERP* = Products in the inventory sources named below; *Inventory sources this ERP ships from* = its codes | the pair's Admin screen → Mapping → the Fulfilment source card, scope Default Config | after a Reset, each ERP's Products page holds only its products; `GET health` on each ERP: `counts.products` | set the mode back to All products |

A product stocked in both ERPs' sources belongs to both. A product in neither belongs to
no ERP and is skipped by both mirrors, with a history entry saying why.

### 3b. Split by a product attribute (the story)

| Have | Where in Admin | Check | Undo |
|---|---|---|---|
| A product attribute `erp_owner`, **Text Field**, added to the attribute set | Stores → Attributes → Product → Add New Attribute; then Stores → Attributes → Attribute Set → drag it into the set | `GET products/attributes/erp_owner` answers with `frontend_input: "text"` | delete the attribute (same screen) |
| A value on every product naming its ERP (`ACME`, `NORTH`) | Catalog → Products → the product; or a mass update via Actions → Update Attributes | `GET products/<sku>`: `custom_attributes` holds `erp_owner` with the value | clear the value, or delete the attribute |
| On each pair: *Which products belong to this ERP* = Products whose attribute names this ERP; *Product attribute that names this ERP* = `erp_owner=ACME` | the pair's Admin screen → Mapping → the Fulfilment source card, scope Default Config | as 3a | set the mode back to All products |

Make it a Text Field. For a Dropdown attribute the API carries the option's number, not its
label, and the setting would have to name that number.

### Both ways: the rest of the two-ERP setup

| Have | Where | Check | Undo |
|---|---|---|---|
| A different order-number prefix on each pair | Mapping → the Order card → *Prefix on ERP order numbers in Commerce* (`ACME`, `NORTH`; blank derives it from the ERP's name, which is only safe when the two names start differently) | after an order: `GET orders/{id}` shows `ext_order_id` like `ACME-0000001042`; the other pair's orders carry the other prefix | Reset clears the ERP numbers |
| Each ERP's own name | Demo Builder's ERP component (`ERP_DISPLAY_NAME`), or the ERP's Settings → Name | the ERP's screen title | rename |
| Optionally, each ERP on its own website (story 2) so each also reads as its own sales organisation | as story 2 | as story 2 | as story 2 |

An order with lines from both ERPs reaches both: each ERP receives it and takes it whole.
Splitting an order between ERPs is the routing layer's job, which this pair does not do
(see the multi-ERP research in the Demo Builder repository).

## Giving the demo

Once the instance has what a story needs, [`walkthrough.md`](walkthrough.md) is the path to
walk: the ERP screen by screen, Commerce from the other side, and how each relates.

## Putting it all back

- **Reset** on either pair's Admin screen undoes every write the integration made onto
  Commerce (credit limits and blocks it changed, product names, prices and stock the ERP
  decided, the ERP number on every order) and rebuilds the ERP from Commerce.
- **Detach**, or removing the integration in Demo Builder, does the first half and leaves
  the ERP alone.
- The Commerce structure you built (websites, sources, attribute, companies) is yours to
  keep or remove with the Admin paths in the Undo columns. Nothing in it belongs to the
  integration.

## What this guide has not proved live

Written 2026-09-24 from the code and the Commerce REST reference, not from a run against an
instance with two websites or two pairs. Two things a first run should confirm and correct
here if wrong: that App Management renders the Structure text fields on its own form the way
the integration's Admin screen does, and the exact `store/websites` and `store/storeConfigs`
field names on Adobe Commerce as a Cloud Service (read from the PaaS reference).
