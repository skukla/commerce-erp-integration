# Demo setup: what the Commerce instance needs for each ERP story

For the person preparing a demo. Three stories, each building on the one before. Every
requirement says where in the Commerce Admin it is set, how to prove it over the REST API
(the same calls the integration makes), and how to undo it. The ERP itself never needs
preparing: Demo Builder fills it from Commerce when the integration is added and on every
Reset (Reset records on the ERP's card in Demo Builder; "Reset" below means that).

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
| Each company that gets its own prices assigned to a shared catalog of its own (one no other company is assigned to; creating a shared catalog creates its customer group) | Catalog → Shared Catalogs → Add Shared Catalog, then Assign Companies | `GET company/{id}` shows a `customer_group_id` no other company has | assign the company back to the default shared catalog |
| The ERP's own warehouse: an inventory source for it, and a stock for the website that holds it (Commerce's Default Stock takes only the Default Source, so a website sells from another source only through a stock of its own; owner, 2026-09-27; Demo Builder's setup guide checks it) | Stores → Inventory → Sources → Add New Source (for example code `northwind`, Northwind Warehouse, an address); Stores → Inventory → Stocks → Add New Stock: the website as its sales channel, the new source assigned; then Catalog → Products, the website's products, Actions → Move stock between <ERP> warehouses (from Default Source); then save each product once, or the storefront still reads the old stock | `GET inventory/stock-source-links?searchCriteria[pageSize]=200` links the source to a stock whose `GET inventory/stocks` entry names the website; `GET inventory/is-product-salable/<sku>/<stock id>` answers true; the storefront shows the product in stock | move the quantities back to Default Source; delete the stock (the website goes back to Default Stock); Commerce cannot delete a source: disable it |
| Optional: a status that shows "confirmed in the ERP" on a pending order | Stores → Settings → Order Status → Create New Status (code `erp_confirmed`), then Assign Status to State: state Pending, NOT as default; put the code in the ERP settings' "Order status when the ERP confirms" | the order's Comments History shows the status after the ERP confirms | clear the setting; unassign the status |
| An order or two placed as a company user | the storefront | `GET orders?searchCriteria[pageSize]=5` | Reset clears the ERP's number from each order; Commerce cannot delete an order |

The customer group matters more than it looks. An order names its buyer's company, so the
ERP books it to the right account whatever the group. A cart does not: the pricing webhooks
carry only the customer group and the buyer's email, so a company left in the General group
(Commerce's default: a company created without choosing a shared catalog joins the default one, and so its group) prices as the walk-in customer at cart time, and its
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

## Story 3: several ERPs and brands on one store

One integration serves several ERPs. Each placed order is split by the ERP that owns each
product; each ERP receives only its own lines, and ships and invoices only those. Demo Builder
adds a second ERP from the integration card ("Add another ERP"); the ERP list is on this app's
Settings page (the ERP switcher).

**Nothing is seeded (owner, 2026-09-28).** The SC creates the brands, the products and the
scenario; the integration responds to whatever is there. The two product values below are the
whole contract between your catalog and the integration.

**Brand and owning ERP are two different values.** `brand` is what a buyer sees: a name on the
product and a search filter, on the one shared website, so one cart can hold several brands.
`erp_owner` is which ERP fulfils the product; routing reads only this. They usually match, but
not always (two brands can share an ERP; one brand can span two). In a customer's deployment
their product information system writes both; in the demo you set them in Commerce.

| Have | Where in Admin | Check | Undo |
|---|---|---|---|
| A product attribute `erp_owner`, **Text Field**, in the attribute set | Stores → Attributes → Product → Add New Attribute; then Stores → Attributes → Attribute Set → drag it into the set | `GET products/attributes/erp_owner` answers with `frontend_input: "text"` | delete the attribute |
| A product attribute `brand` (Text Field or Dropdown), in the attribute set, **Use in Search Results Layered Navigation** / filterable if you want it as a storefront filter | same screens | `GET products/attributes/brand` | delete the attribute |
| On each product you sell through an ERP: `erp_owner` = that ERP's **id** (shown on the Settings page's ERP switcher and in Demo Builder, e.g. `demo-erp-2`, never its display name) and `brand` = the brand you are showing | Catalog → Products → the product; or Actions → Update Attributes for many | `GET products/<sku>`: `custom_attributes` holds both | clear the values |
| The ERP's own warehouse for each ERP (an inventory source and the website's stock, as in story 1) | as story 1 | as story 1 | as story 1 |
| An order status **Partially Held** (code `partially_held`), assigned to the **Processing** and **Pending** states. The integration sets it when one ERP's part waits (credit hold, block, ERP down) while other parts move; Commerce's On Hold is used only when every part waits, because an order On Hold cannot be shipped or invoiced. Without the status, the integration writes the note alone and logs the refusal; nothing breaks | Stores → Settings → Order Status → Create New Status (code `partially_held`, label Partially Held); then Assign Status to State, once for Processing and once for Pending (not default, not visible on storefront) | with one ERP's part held and another's moving: `GET orders/{id}` shows `status: "partially_held"` and the state unchanged | Stores → Settings → Order Status → Unassign from each state, then delete the status |

What the integration does with what you created:

- A product whose `erp_owner` names a listed ERP routes to it.
- A product with no owner, or naming an ERP that is not listed, is held on the order and shown
  to staff; the rest of the order still goes.
- With one ERP, every product goes to it; the values change nothing.

`erp_owner` must be a Text Field: a Dropdown's API value is the option's number, not its label.
Each ERP can instead own products by inventory source or by another attribute (the ERP's own
settings on the Settings page, "Which products belong to this ERP"), for a store whose
warehouses already map one-to-one onto ERPs.

## Giving the demo

Once the instance has what a story needs, [`walkthrough.md`](walkthrough.md) is the path to
walk: the ERP screen by screen, Commerce from the other side, and how each relates.

## Putting it all back

- **Reset records** on the ERP's card in Demo Builder undoes every write the integration made
  onto Commerce (credit limits it changed, product names, prices and stock the ERP
  decided, the ERP number on every order), wipes the ERP and fills it from Commerce again.
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
