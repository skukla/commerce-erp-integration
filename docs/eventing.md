# Events, not cron: how changes travel, and where to look when they do not

This pair is event-driven in both directions. Nothing polls Commerce for orders, and the ERP
does not poll Commerce for anything except the partner and stock refresh every minute (a
timer, because Commerce has no company event and stock per source is not in the stock event).
Everything below was learned against a real Commerce as a Cloud Service instance on
2026-09-24 and 25; the ledger in `live-validation-learnings.md` names the tests that pin it.

## Commerce → the integration

Commerce raises an event when an observer fires (a product save, an order save, a shipment,
an invoice, a stock save). The event goes to Adobe I/O Events, which delivers it to the
registration's webhook: one Runtime action of this integration per event. That action reads
what it needs from Commerce over REST, calls the ERP, and answers 200 (done), 400 (drop it)
or 5xx (deliver again).

**Commerce has two ways to send an event, and only one of them worked on the sandbox.**

- *Normal events* are queued and sent by the `event_data_batch_send` cron job. On the
  sandbox that cron did not run for hours: registration tracing showed only the challenge
  probe after price changes over the API, Admin saves, a linked provider id, "Execute
  Synchronization" and a successful "Send Test Event". Adobe's own support history shows the
  same symptom ("missed its scheduled run") on other Cloud Service sandboxes.
- *Priority events* skip the cron: a message-queue consumer publishes them within a few
  seconds. Marking a subscription `priority: true` made the next save arrive in five seconds.

Every event this pair subscribes is therefore priority (`app.commerce.config.ts`). If an
event ever needs to be normal, know that on a sandbox it may never leave.

**What the Admin's test button proves.** *Stores → Configuration → Adobe Services → Adobe
I/O Events → Send Test Event* sends a `connection_testing` probe. It proves the credentials
and the provider; it says nothing about whether real events are dispatched.

**Provider ID.** The Admin's eventing configuration needs the event provider's id filled in;
with it blank, "Execute Synchronization" succeeds and nothing is sent. The installer in
`@adobe/aio-commerce-lib-app` 2.0.0 never sends it (its eventing configuration call carries
enabled, environment, instance, merchant and workspace only), so this app sets it itself: a
custom installation step (`src/installation/set-event-provider.js`) writes this app's Commerce
provider id with `PUT V1/eventing/updateConfiguration`. Only the first copy on a store does,
since the field is one per store and cannot be read; removing that copy clears it.

## Where to look when an event does not arrive

In this order; each step names what it proves.

1. **The registration's debug tracing** in the Adobe Developer Console (the project's
   workspace → Events → the registration → Debug Tracing). This is the truth: every
   delivery attempt with its payload, the response code and the time. Only the challenge
   probe means Commerce never sent it. A delivery with a 5xx means the handler failed and
   I/O Events will retry. The Event Browser journal is empty for webhook registrations and
   proves nothing.
2. **The subscription** on the instance: `GET /V1/eventing/eventSubscribe` lists what is
   subscribed and whether it is `priority`. The Demo Builder agent tool `run_commerce_rest`
   reads it.
3. **Commerce's own event log** in the Admin (*System → Events → Events Status*): status 0 is
   waiting for the cron, 1 sent, 2 failed, 3 sending. A row stuck at 0 is the cron not
   running.
4. **The handler's run** in Runtime: `list_runtime_activations` and `read_runtime_activation`
   in Demo Builder, or `aio runtime activation list`. Runtime records a blocking web action's
   activation **only when it failed**, unless the request carried `X-OW-EXTRA-LOGGING: on`
   (Adobe Runtime, "Logging and monitoring"). Timer runs are always recorded. A missing row is
   "no failure recorded", never "it did not run".
5. **The integration's history** on the Commerce Admin screen, and the agent tool
   `get_erp_order_trace`: what crossed and how it ended, with a Retry on what did not.

## Retries and their side effects

I/O Events redelivers a webhook that answered 5xx at 1, 2, 4 and 8 minutes, then every 15
minutes for up to a day. Two consequences shaped the handlers:

- A handler must be idempotent. The ERP's order create answers the same number for the same
  Commerce order, so a redelivery after a timed-out write-back cannot double-create.
- A handler must answer 400, not 5xx, for an event it will never be able to apply (a setting
  Commerce refuses, an order that does not exist), or the retries run for a day.

## Two Commerce event quirks the order handler has to know

- An order placed through the REST cart is saved more than once while it is placed, and the
  commit event that fires carries `_isNew: false`. Whether an order goes to the ERP is decided
  by whether the ERP already has it, never by that flag.
- Writing the ERP number back (`POST /V1/orders` with `entity_id` and `ext_order_id`) raises
  the order save event again with only the saved fields in it, so it has no `increment_id`.
  That event is the integration's own doing and is skipped.

## The ERP → the integration

The ERP publishes its events (a status change, a shipment, an invoice, a credit or block
change, a price or stock change) to the integration's ingestion webhook, which publishes them
to Adobe I/O Events under the ERP provider; the `order-backoffice/*`, `product-backoffice/*`,
`stock-backoffice/*` and `company-backoffice/*` actions apply them to Commerce. The ERP keeps
its own outbound journal (`GET events` on the ERP; `attempts`, `deliveredAt`, `lastError`) and
a retry timer every minute, so an ERP event survives the integration being briefly down.

Commerce's own events for what the integration just did (a shipment it created, an invoice it
posted) come back to the integration. The handlers match them to the ERP document that caused
them and do not echo them to the ERP; the entity matrix in `test/box/journeys.test.js` pins
each of those round trips.
