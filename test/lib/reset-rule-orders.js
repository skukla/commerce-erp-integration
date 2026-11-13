/*
 * The example orders of the ONE reset rule (owner, 2026-10-30; changed 2026-11-11), shared with
 * Demo Builder's Clear, read from test/fixtures/reset-rule-orders.json. That file is a
 * byte-for-byte copy of Demo Builder's tests/fixtures/reset-rule-orders.json, which owns the cases
 * (the owner's names, word for word) and types them to Commerce's wire shapes; both repositories
 * pin its sha-256 (reset-rule-table.test.js here). To change a case, change Demo Builder's file
 * and re-sync with its scripts/sync-reset-rule-orders.mjs; never edit the copy here.
 *
 * Each case: `name`, `order` and `returns` shaped as `GET orders/{id}` and `GET returns/{id}`
 * answer, `expected` ("canceled" | "refunded" | "untouched"), `closesReturn` (the return the rule
 * closes, by id) and `invoices` (something is not yet invoiced, so the rule invoices it all before
 * refunding everything invoiced). None of these bodies is captured from a live store.
 */
import { readFileSync } from "node:fs";

const COPY = new URL("../fixtures/reset-rule-orders.json", import.meta.url);

export const RESET_RULE_CASES = JSON.parse(readFileSync(COPY, "utf8")).cases;
