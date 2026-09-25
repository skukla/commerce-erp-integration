# What live testing taught, and where each lesson is pinned

A ledger of facts about Adobe Commerce and Adobe I/O that were learned by running this pair
against a real Commerce as a Cloud Service instance, not by reading. Each row names the
evidence, the test that fails if the code forgets the lesson, and the document a person reads.
`test/docs/learnings.test.js` checks that every test named here still exists, so a lesson
cannot be dropped from the suite without this page saying so.

**Adding a row:** when a live run teaches something the code or the guide did not know, fix
the code, write the test, and add the row in the same commit. A lesson with no test is a
claim; a test with no row is a rule nobody can find.

| Date | Lesson | Evidence | Pinned by | Documented in |
|---|---|---|---|---|
| 2026-09-24 | Commerce on this sandbox does not dispatch normal (batch, cron-driven) events; priority events go out through the message queue within seconds. Every Commerce event this pair subscribes is priority. | Registration debug tracing in the Developer Console: only the challenge probe for hours; a priority subscription delivered the next save in 5 s | `app.commerce.config.ts` (`priority: true` on all six events) | `docs/eventing.md` |
| 2026-09-24 | A successful blocking web-action activation is not recorded in Runtime unless the request carried `X-OW-EXTRA-LOGGING: on`; failures and timer runs are. A missing activation row is "no failure recorded", never "did not run". | Adobe Runtime "Logging and monitoring" guide; a block applied by the status handler left no row while every failed credit run did | (extension: `list_runtime_activations` description) | Demo Builder `docs/systems/erp-integration.md` |
| 2026-09-25 | An order placed through the REST cart is saved more than once while it is placed; the commit event carries `_isNew: false`. Whether to send an order is decided by whether the ERP already has it, never by that flag. | Order 3000000005 arrived with the flag false and was skipped; the ERP never saw it | `Then a later save WITHOUT an ERP number is sent again, whatever Commerce's new-flag says` | `src/lib/order-sync.js` header |
| 2026-09-25 | Commerce puts every company in the General customer group unless a shared catalog assigns its own, so a group cannot name a company. The order carries the buyer's Commerce company id, read off the customer record; the ERP treats a group two partners share as naming neither. | Three companies on group 1; an order for company 21 was booked to company 20 and held against a zero limit | `Then the buyer's company goes with the order, and a company that cannot be read is null, not a guess`; in demo-erp, the partner-resolution test in `test/records.test.js` | `docs/demo-setup.md` (one group per company) |
| 2026-09-25 | The Commerce client's default request timeout is ten seconds (ky's default, inherited through aio-commerce-lib-app). This sandbox exceeds it routinely; a timed-out write can still land. Every client here waits thirty seconds. | The write-back of an ERP number timed out at 10 s and landed; four credit-hold deliveries failed on the read before them | `Then every client waits thirty seconds for Commerce, not the library's ten` | `src/lib/commerce.js` |
| 2026-09-25 | The write-back of the ERP number raises the order save event again with only the saved fields in it (no `increment_id`). That event is ours and is skipped as such. | A 400 "no order number" three milliseconds after every write-back | `Then the write-back's own save event, carrying no order number, is skipped, and one with nothing is dropped naming its fields` | `src/lib/order-sync.js` |
| 2026-09-25 | An order status comment may set only a status of the order's current state; an order leaves Pending when it is invoiced or ships, never by a comment. "Confirmed in the ERP" is a note plus, optionally, a custom status the SC assigns to the Pending state. | Commerce answered 400 "The status \"processing\" is not part of the order status history" on a pending order and accepted the same comment on a processing one; Experience League "Order status" and "Order workflow and processing" | `Then a status Commerce refuses (400: not of the order's state) still leaves the note, and the delivery succeeds`; the box's fake Commerce refuses it too | `docs/demo-setup.md`, `app.commerce.config.ts` (the setting's description) |
| 2026-09-25 | The ship, invoice, cancel, hold and unhold calls match Adobe's REST tutorials: `POST order/{id}/ship` with `items[{order_item_id, qty}]` and the inventory source; `POST order/{id}/invoice` with `capture: true`; a full shipment plus invoice completes the order. | Order 3000000007 shipped, invoiced and completed from the ERP; Commerce's own shipment event came back and was matched, not shipped twice | `test/box/journeys.test.js` (the entity matrix) | `docs/commerce-api-inventory.md` |
| 2026-09-25 | A B2B company POST needs `region_id`; a company PUT must send the whole record; a credit PUT needs `currency_code` and the credit record's own id. | 400s and a 404 "customerGroupId null" on partial writes | `test/lib/commerce-credit.test.js` | `docs/commerce-api-inventory.md` |
| 2026-09-25 | App Management upgrades an installed app (webhooks, events, the settings schema) only when `metadata.version` in `app.commerce.config.ts` changes. A redeploy without a bump carries the code and Commerce keeps the old registrations. Bump the version in the same commit as any change to what that file registers. | Three redeploys carried a replaced setting and new webhook headers and timeouts; `GET webhooks/list` still showed the old registration until 0.7.0 | the comment above `version:` in `app.commerce.config.ts`; `git log -S 'version: "0.'` | `README.md` ("Changing a webhook or event after install") |
| 2026-09-25 | Commerce strips the `plugin.magento.` prefix from webhook method names on storage, so a registration written as `plugin.out_of_process_totals_collector…` is the documented `plugin.magento.out_of_process_totals_collector…`. Not a cause of a silent webhook. | The App Management library's own `normalizeWebhookMethod` comment; `webhooks/list` on the instance | (no test: library behaviour) | `docs/eventing.md` |

## What the live runs proved, in order

1. Commerce → ERP: product save (name and price), order placement with the ERP number written
   back, Commerce's own shipment event matched on the ERP order.
2. ERP → Commerce: credit limit and block on the company, order confirmation (a note), credit
   rejection (cancels the Commerce order), shipment, invoice.
3. The agent tools read both sides and the crossing between them (`get_erp_order_trace`).

Not yet proven live: a storefront order (the cart pricing webhooks), the credit-hold round trip
on an order that is actually over its limit, `remove_integration` reverting the ledgered writes,
and a fresh add's install-time first sync.
