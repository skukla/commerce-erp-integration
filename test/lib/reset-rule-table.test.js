/*
 * The one reset rule's cases come from ONE file, owned by Demo Builder
 * (demo-builder-vscode tests/fixtures/reset-rule-orders.json). test/fixtures/reset-rule-orders.json
 * here is a byte-for-byte copy, read by every reset test through reset-rule-orders.js. Both
 * repositories pin the file's sha-256, the same value, so a table changed in one and not the other
 * fails a suite. To re-sync, from a Demo Builder checkout:
 *
 *     node scripts/sync-reset-rule-orders.mjs <path to this checkout>
 *
 * then put the fingerprint it prints into PINNED_FINGERPRINT below. Never edit the copy here.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { RESET_RULE_CASES } from "./reset-rule-orders.js";

const COPY = new URL("../fixtures/reset-rule-orders.json", import.meta.url);

/** The same value is pinned in demo-builder-vscode, demoDataWipe/resetRuleTable.test.ts. */
const PINNED_FINGERPRINT =
  "90e96d8e0db02132e71b6150b394e3de412247a48ee349062354c1c250ad9bae";

test("The copy of the reset rule's cases is the one Demo Builder pins", () => {
  const fingerprint = createHash("sha256")
    .update(readFileSync(COPY))
    .digest("hex");
  const verdict =
    fingerprint === PINNED_FINGERPRINT
      ? "pinned"
      : `test/fixtures/reset-rule-orders.json (sha-256 ${fingerprint}) is not the pinned copy of ` +
        "demo-builder-vscode tests/fixtures/reset-rule-orders.json. Do not edit it here: from a " +
        "Demo Builder checkout run `node scripts/sync-reset-rule-orders.mjs <this checkout>`, " +
        "then put the fingerprint it prints into PINNED_FINGERPRINT here and in Demo Builder's " +
        "resetRuleTable.test.ts.";
  expect(verdict).toBe("pinned");
});

test("The reset tests read every case of the shared file", () => {
  const { cases } = JSON.parse(readFileSync(COPY, "utf8"));
  expect(RESET_RULE_CASES).toEqual(cases);
  expect(RESET_RULE_CASES.map((c) => c.name)).toEqual([
    "(1) pending, nothing invoiced → canceled",
    "(2) invoiced, not shipped → refunded, closed",
    "(3) invoiced and shipped → refunded, closed",
    "(4) invoiced with an open return → refunded, closed, return closed",
    "(5) already closed → untouched",
    "shipped, not invoiced → invoiced, refunded, closed",
    "partly invoiced → invoiced, refunded, closed",
  ]);
});
