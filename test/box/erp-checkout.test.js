/*
 * The pair-in-a-box journeys load the ERP from a checkout beside this repo. These pin the
 * two ways that goes wrong quietly: no checkout (a bare crash on a require), and a checkout
 * on another contract (journeys passing against an ERP this app was not written for).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkErpCheckout } from "./erp-in-process.js";

const CONTRACT = { contractVersion: 2, routes: { orders: ["GET"] } };

/** A folder holding `contract/erp-contract.json` with this content, or nothing. */
function checkout(contract) {
  const root = mkdtempSync(path.join(tmpdir(), "erp-checkout-"));
  if (contract) {
    mkdirSync(path.join(root, "contract"));
    writeFileSync(
      path.join(root, "contract", "erp-contract.json"),
      JSON.stringify(contract),
    );
  }
  return root;
}

const vendored = path.join(checkout(CONTRACT), "contract", "erp-contract.json");

describe("Given the ERP checkout the journeys load", () => {
  test("Then a checkout on this app's contract passes", () => {
    expect(() => checkErpCheckout(checkout(CONTRACT), vendored)).not.toThrow();
  });

  test("Then a missing checkout says where it should be", () => {
    const root = checkout(null);
    expect(() => checkErpCheckout(root, vendored)).toThrow(
      `need the ERP checked out beside this repo, at ${root}`,
    );
  });

  test("Then a checkout on another contract is refused", () => {
    const root = checkout({ ...CONTRACT, contractVersion: 3 });
    expect(() => checkErpCheckout(root, vendored)).toThrow(
      "has a different contract",
    );
  });
});
