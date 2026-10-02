# Sync validation — every entity, both directions, on a live instance

The live counterpart of the box journeys (`test/box/journeys.test.js`,
`test/box/several-erps.test.js`): one journey per row of the entity-coverage matrix
(`.rptc/research/erp-bidirectional-review/`), each written so you can run it by hand against a
deployed pair and check the result at every step. The box journeys prove the same paths in
process; this proves them against real Commerce and a real ERP.

**When to run:** as a baseline against today's code, again after a change to any sync path, and
before every release. **Products first** — they are the simplest round trip and the one every
other entity leans on.

**How to read a step:** *Do* names where to act (Commerce Admin, the ERP screen, or a tool);
*Expect* is what you should see, and where. A step marked **GAP Gn** is a known hole from the
matrix — its "expect" is the current (wrong) behaviour, recorded so a run does not read it as a
regression. Reset always comes last: it must return the pair to zero.

Record each row's result inline: `PASS <date>`, or `FAIL <date> — <what happened>`.

---

## 1. Product (name, price, type) — both ways · Result: PASS 2026-09-29 (price both ways)

> Live on Bodea 2026-09-29 via the agent tools: §1.2 Commerce→ERP price PASS ~5s
> (switchenterprise8 →333 reached the ERP); §1.3 ERP→Commerce price PASS ~10s (accesspoint
> ERP →249 reached Commerce, ledgered). Create (§1.1), the G1 delete and the §1.5 reset legs
> not run in this pass. The ERP→Commerce leg was blocked until AB-40 was fixed
> (write_erp_rest leaked ERP_ID into the body); the Commerce PUT needed a >120s timeout.

1. **Do:** in Commerce Admin, create a simple product whose SKU an ERP owns (its `erp_owner`
   attribute, or a stocked source of that ERP). **Expect:** the ERP's Products screen shows the
   new item — SKU, name, price, type — within a few seconds.
2. **Do:** in Commerce Admin, change that product's name and price. **Expect:** the ERP's item
   shows the new name and price.
3. **Do:** on the ERP's Products screen, change the item's price (and name). **Expect:** the
   Commerce product shows the ERP's value (this write is ledgered).
4. **GAP G1 — Do:** delete the product in Commerce Admin. **Expect (current):** the ERP still
   lists it; the record lingers until reset. Record as G1, not a regression.
5. **Reset:** run a reset. **Expect:** the ERP's product records match Commerce as it stands;
   the ledgered ERP price edit is reverted.

## 2. Stock per source — both ways · Result: §2.2 PASS 2026-09-29; §2.1 = GAP G2 (confirmed)

> Live on Bodea 2026-09-29: §2.2 ERP→Commerce PASS — set accesspoint northwind warehouse
> qty=77 on the ERP → Commerce inventory/source-items for source `northwind` = 77 (the legacy
> stockItems aggregate reads 0, so use source-items to verify). §2.1 Commerce→ERP via an MSI
> source-item write (inventory/source-items POST, qty 88) did NOT reach the ERP in 120s —
> confirmed GAP G2 / the AB-26h gap by the subscription: commerce-events.js:19 listens to the
> LEGACY `cataloginventory_stock_item_save_commit_after`, not MSI `inventory_source_item`
> events, so per-source edits never fire the handler. Known gap, not a regression. Reset not run.

1. **Do:** in Commerce Admin, set the quantity of an ERP-owned SKU at that ERP's **default**
   inventory source. **Expect:** the ERP's warehouse quantity for that item matches.
2. **Do:** on the ERP screen, change the item's on-hand quantity. **Expect:** the Commerce
   source item for that source shows the ERP's number (ledgered).
3. **GAP G2 — Do:** in Commerce Admin, edit the quantity at a **non-default** source.
   **Expect (current):** the change does not reach the ERP until reset, and the ERP overwrites
   it on its next stock edit. Record as G2.
4. **Reset:** **Expect:** stock matches Commerce; ledgered ERP stock edits reverted.

## 3. Company (customer) — Commerce → ERP · Result: PASS 2026-09-29 (after AB-41 field fix)

> RESOLVED. The company event was registered with field `id`, but the B2B Company entity
> exposes `entity_id` (Adobe docs: entity observer events use entity_id; confirmed in the Admin
> Events Subscriptions grid — sales docs use entity_id, company had id). Set the subscription
> field to `entity_id` → renaming company 21 updated the ERP partner name in ~10s. Code fix on
> main (company event fields = [entity_id]). Note: the aio-commerce-lib deploy reconcile did NOT
> push the field change to the existing subscription (stayed at id across redeploys); Bodea was
> fixed by a manual Admin edit — existing projects need a forced re-subscribe (AB-41 secondary
> finding). Original diagnosis kept below for the record.

> Live on Bodea 2026-09-29: renamed company 21 to "Kukla Studios QA" in Commerce (REST PUT
> succeeded); the ERP partner name did NOT update in 150s. Diagnosed: the company-saved event
> DID dispatch (runtime activation `company-commerce/saved` ran, status 1) and failed with
> "the company event carries no company id" (400). The subscription declares fields:[{id}]
> (app.commerce.manifest.json) but the handler (saved/index.js:28) reads data.value.id and got
> none — the B2B Company entity's key is entity_id, not id, so `id` extracts nothing. Company
> updates never sync via events; companies are only paired at the bulk fill. Filed AB-41. The
> initial two attempts also failed on my side (company PUT needs the full address block) —
> the third PUT was valid and the failure above is the real sync gap.
>
> UPDATE (deeper diagnosis, same day): the HANDLER is fixed on main (reads entity_id ?? id;
> a direct replay renamed the partner live) — but a diagnostic deploy showed the event arrives
> with `data.value = {}`: Commerce extracts NONE of the subscription's fields for this event.
> The real blocker is that the Commerce event subscription does NOT re-register its fields on a
> plain redeploy (the "Refresh registrations" trap); no targeted refresh tool exists, only a
> heavy reinstall. So §3 stays FAIL pending the eventing re-registration — that is AB-41's
> remaining work, not a field swap.

1. **Do:** in Commerce Admin, create a B2B company (name, legal identity, admin) that trades on
   a website an ERP serves. **Expect:** the ERP's Business partners screen shows the company as
   a customer (sold-to), paired by its customer number; its sales organisation reflects the
   website's setting.
2. **Do:** change the company's name/legal fields. **Expect:** the ERP's partner updates.
3. **Reset:** **Expect:** partners match Commerce; the pair is rebuilt.

## 4. Credit limit and block — ERP → Commerce · Result: PASS 2026-09-29 (limit); block not run

> Live on Bodea 2026-09-29: set C21 (Kukla Studios) creditLimit=150000 on Northwind →
> Commerce company 21 credit reached 150000 in ~10s. OBSERVATION to confirm: Bodea has two
> ERPs both holding C21 at 120000; Commerce showed 150000 (Northwind's value), NOT a 270000
> cross-ERP total. RESOLVED — correct behaviour: `erp-credit.js` sums each ERP's own
> `erp_<id>_credit_limit` attribute, and the fill copies Commerce→ERP without writing that
> attribute, so Contoso's 120000 was never a ledgered edit (0 in the sum). Confirmed live:
> then set Contoso C21=50000 → Commerce became 200000 (=150000+50000) in ~10s. The
> aggregation sums ledgered edits correctly. Block (step 2) and reset not run.

1. **Do:** on the ERP screen, set the partner's credit limit. **Expect:** the Commerce company's
   credit limit shows the ERP's value (ledgered). With several ERPs, Commerce's limit is the
   total across ERPs; each ERP's own figure is in its prefixed company attribute.
2. **Do:** on the ERP screen, block the partner. **Expect:** that ERP's orders for the company
   are held; the other ERPs keep flowing (the company flag is not written).
3. **GAP G3 — Expect:** Commerce's balance and the ERP's exposure can disagree; the ERP's
   exposure is the demo's truth (stated on the Credit card). Record as G3, not a regression.
4. **Reset:** **Expect:** the credit limit and block are undone; with several ERPs, the limit is
   recomputed to the remaining ERPs' total.

## 5. Order — Commerce → ERP, status back · Result: PASS 2026-09-29

> Live on Bodea 2026-09-29. Order built and placed via REST for Kukla Studios (company 21):
> customer cart (customers/44/carts → items → shipping-information gave companycredit "Payment
> on Account", contract price 149 applied) then created via the Order API `POST /V1/orders`
> (order 000000001, entity_id 24). §5.1 PASS: Northwind ERP created sales order 0000001014 in
> ~11s; get_erp_order_trace shows the crossing. §5.2 PASS: confirming on the ERP set Commerce
> status `erp_confirmed` (the custom status on the Pending STATE, not Processing) — exactly the
> documented rule. Note: `POST /V1/carts/{id}/payment-information` is mine/guest-only (404 for
> admin); the Order API is the admin/integration path.
>
> AB-37 #2 (PO invoicing at checkout): ANSWERED — Payment on Account is NOT invoiced at
> checkout (total_due stayed 298, nothing paid until the ERP invoiced). The "Order workflow"
> doc is right; the "Invoices" claim does not hold for Payment on Account on ACCS.
> AB-37 #1 (attribute write after Pending): ANSWERED — `ext_order_id` was written to the order
> while in PROCESSING (post-Pending) via `POST /V1/orders` and read back. The ERP-number
> write-back works regardless of state; the "only when Pending" limit is about genuinely custom
> attributes, which the integration does not rely on for the ERP number.

1. **Do:** place an order on the storefront for products the ERP owns. **Expect:** the ERP's
   Sales orders screen shows a new sales order; Commerce's order shows the ERP number as
   `ext_order_id` (`<PREFIX>-<ten digits>`) and a note. A mixed order splits: each ERP gets only
   its own lines, and the order carries each ERP's number.
2. **Do:** confirm the order on the ERP screen. **Expect:** the Commerce order gains a comment
   (and moves to the configured Pending status if one is set); it does not jump to Processing.
3. **Reset:** **Expect:** an order Commerce can still cancel is cancelled; one it cannot keeps a
   note; the ERP number is cleared; the integration forgets the order.

## 6. Shipment and invoice — both ways · Result: PASS 2026-09-29 (after AB-43 two-part fix)

> Live on Bodea 2026-09-29. ERP ship route is `orders/<n>/shipments` (create, `{lines:[{item,
> qty}]}`) → `.../shipments/<id>/post`, then `orders/<n>/invoice`. INVOICE E→C PASS: the ERP
> invoice reached Commerce (order → processing, total_invoiced/paid 298). SHIPMENT E→C first
> FAILED (400 on POST order/{id}/ship), then FIXED (AB-43) and re-proven on order 000000003 /
> ERP 0000001016: shipped with no warehouse → applied to Commerce. TWO bugs, both non-default-
> source only (why prior default-source shipments "passed"): (1) demo-erp createShipment left
> warehouse null → Commerce source "default", where accesspoint is not → default to the shipped
> products' warehouse; (2) the integration sent the MSI source in a top-level extension_attributes,
> which salesShipOrder ignores → move under `arguments.extension_attributes.source_code`. The
> box's fake Commerce read the top-level field too — that agreement is why it shipped; the fake
> is now faithful. SHIPMENT C→E (§6.3) PASS: fresh order 000000004 / ERP 0000001017, shipped in
> Commerce Admin from source `northwind` (`POST order/{id}/ship` with the source under
> `arguments.extension_attributes`) → the ERP recorded it in ~10s (shippedQty=2, shippingStatus
> full). So the shipment round-trips both directions.

1. **Do:** on the ERP screen, ship the order's lines. **Expect:** Commerce records a shipment
   with those items and the source code.
2. **Do:** on the ERP screen, invoice the order. **Expect:** Commerce records the invoice
   (capture) and a comment; Commerce moves the order toward Complete.
3. **Do:** in Commerce Admin, create a shipment / invoice for the order's lines. **Expect:** the
   ERP is told and shows the delivery / billing for its own lines (invoice before shipment; one
   invoice at a time per order).
4. **Reset:** **Expect:** shipments and invoices stay (documented exception — Commerce cannot
   delete them); the ERP number is cleared.

## 7. Cancel and hold in Commerce — Commerce → ERP · Result: §7.1 PASS 2026-09-29 · §7.2 GAP (G4)

> Live on Bodea 2026-09-29.
> **§7.1 CANCEL — PASS.** Fresh order 000000005 / ERP 0000001018. `POST orders/{id}/cancel` in
> Commerce → the ERP sales order moved to header/status `canceled` (overall Canceled) in ~10s.
> **§7.2 HOLD/UNHOLD — GAP, not runnable.** Two reasons, both confirmed:
> 1. The ERP integration subscribes to no hold event — Commerce→ERP hold sync is the unbuilt G4
>    matrix item. Order 000000006 / ERP 0000001019 stayed ERP-Open across a Commerce hold.
> 2. It cannot even be STAGED via the agent/REST surface: `POST orders/{id}/hold` returns `true`
>    but the order does not hold on this ACCS instance — measured on entity_id 29, `state=new
>    status=pending hold_before_state=None` immediately after a true-returning hold, and a
>    following unhold answers HTTP 400 "You cannot remove the hold" (i.e. it was never held). So
>    the Commerce REST hold action is a no-op here; a UI-driven hold would be needed to test the
>    sync, and the sync is not built regardless.

1. **Do:** in Commerce Admin, cancel an order the ERP holds. **Expect:** the ERP is told and
   marks its sales order cancelled (with the origin marker, so it does not echo back). — PASS.
2. **Do:** in Commerce Admin, hold / unhold an order. **Expect:** the ERP reflects the hold /
   release. (Matrix item 1 / G4 — confirm built before running.) — GAP: not built; and REST hold
   is a no-op on ACCS, so not stageable via the agent surface.
3. **Reset:** **Expect:** holds the integration placed are released.

## 8. Contract prices → shared catalog — ERP → Commerce · Result: PASS 2026-09-29

> Live on Bodea 2026-09-29: POST pricing on the ERP (contractPrice, partner C21, sku
> accesspoint, price 149) → within ~2 min a Commerce tier price appeared for accesspoint,
> customer_group "Kukla Studios", fixed 149, qty 1 (read via products/tier-prices-information).
> Event-driven publish (contract.changed → tier price), no fill needed. Note: the same read
> showed a pre-existing "ServerSavvy Solutions" fixed-199 tier price the ERP never wrote —
> the exact AB-42 case (shared-catalog prices the ERP does not know about). Reset not run.

1. **Do:** on the ERP screen, set a contract price (a pricing condition, above the discount
   ceiling) for a company on a product that ERP owns. **Expect:** the company sees its contract
   price in the storefront everywhere; the price is published into the company's own shared
   catalog. Publication runs on fill/reset and on the price publish's schedule (a setting,
   hourly at :05 UTC by default; README, Schedules).
2. **Reset:** **Expect:** the company's contract prices are re-published from the ERP as it
   stands.

## 9. Currency — · Result: GAP G5 — NARROWED to a display gap (verified live 2026-09-29)

> Re-checked against the code and the live ERPs. G5 as first written ("the ERP has no currency
> of its own") is **false**: the currency data pipe works end-to-end and is populated.
> - **Verified live:** both ERPs report `companyCode.currency = "USD"` (health.structure), read
>   from the Commerce store's `base_currency_code` by the extension's fill
>   (`erpFillReaders.ts:220` → `erpFillRows.ts:286` `storeInfo.currency` → ERP `admin` import →
>   `settings.structureMirror` → `describeStructure` `companyCode.currency`,
>   `demo-erp/lib/structure.js:70`). The ERP contract already declares `storeInfo.currency`.
> - **Orders** already carry their own document currency (`demo-erp/lib/orders.js:230`, from the
>   Commerce order).
> - **The gap was display-only, and is now FIXED (2026-09-29).** The screen already formatted
>   money in the ERP's currency but as a SYMBOL (`$1,850.00`); the one bare-number case was the
>   server credit hold reason (`demo-erp/lib/credit.js` `amount()`). Both now show the ISO CODE,
>   the ERP convention (SAP's currency key, Business Central's currency code):
>   - `demo-erp/screen/src/money.js` `moneyOptions()` adds `currencyDisplay: 'code'` → every
>     screen money reads `USD 1,850.00`.
>   - `demo-erp/lib/credit.js` `amount(value, currency)` prefixes the code; `decide()` and
>     `lib/orders.js` thread the order currency → the hold reason reads `Credit limit USD
>     1,000.00 exceeded by USD 3,820.00`. The stale "no currency yet" comment is removed.
>   demo-erp 370/370 (screen fingerprints re-accepted: 4 money screens, element counts
>   unchanged); commerce-erp-integration 932/932 (box journey regex + 2 fixtures re-pinned to the
>   new reason). The LIVE ERPs show the new format only after a demo-erp redeploy. Currency is
>   not a synced entity (nothing round-trips it), so §9 stays a read, not a journey.

---

## Several ERPs · Result: PASS 2026-09-29 (split + isolation + reset)

Run §1–§8 with **two** ERPs added to one integration, using products each ERP owns and one order
that spans both. Confirm at each step that a change reaches only the owning ERP, that each ERP
reports only its own part, and that reset returns both ERPs to zero in either order. The box
version is `test/box/several-erps.test.js`.

> Live on Bodea 2026-09-29 with **Northwind (demo-erp)** and **Contoso (demo-erp-2)** attached to
> the one integration — disjoint products (Northwind: accesspoint/switchenterprise8/switchlite8;
> Contoso: poweredger752/primergyrx4770m5/proliantdl380).
> - **Split order — PASS.** One Commerce order 000000007 (accesspoint + poweredger752) fanned out
>   to **both** ERPs: Northwind created sales order 0000001020 holding only `accesspoint`, Contoso
>   created 0000001003 holding only `poweredger752`. Both parts `sent`; both ERP orders carry the
>   same `commerceOrderId=30`; the single Commerce order stayed `pending`. So one Commerce order
>   splits ERP-side and each ERP reports only its own part (`router/route-order.js`,
>   `order-parts.js`). Also settled that accesspoint (whose `erp_owner` attribute reads `"erp"`)
>   still routes to Northwind.
> - **Write isolation — PASS.** A price write on Contoso (poweredger752 1850→1875) reached Commerce
>   in ~5s; Northwind never held the SKU. Reverted to 1850 (Contoso ERP restored; Commerce
>   re-publish confirmed).
> - **Reset — PASS.** `reset_erp_records` returned both ERPs to zero: 2 pending orders cancelled
>   (29, 30), 5 shipped/invoiced orders kept + noted (Commerce cannot delete their
>   shipments/invoices — the documented exception), 7 order parts removed, 8 credit reversions
>   undone, both ERPs wiped and refilled from Commerce (Northwind 4 partners/3 products, Contoso
>   likewise). After reset each ERP holds 0 orders and mirrors Commerce. The report also confirmed
>   ownership: Northwind owns "products whose erp_owner is erp", Contoso "…is demo-erp-2".
