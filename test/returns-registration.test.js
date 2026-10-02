/*
 * Returns and credit memos are registered everywhere a handler must be to run: the Commerce
 * and ERP events in app.commerce.config.ts, the actions in their packages, the generated
 * manifest the running actions read, the Admin history's Retry, and a version bump, without
 * which App Management never upgrades the subscriptions on an installed store.
 */
import { readFileSync } from "node:fs";

import { HANDLER_ACTIONS } from "#lib/erp-event-history";

import config from "../app.commerce.config.ts";
import manifest from "../src/commerce-extensibility-1/.generated/app.commerce.manifest.json" with {
  type: "json",
};

const ACTIONS = "src/commerce-extensibility-1/actions/order";
const commerceEvents = config.eventing.commerce.flatMap((p) => p.events);
const externalEvents = config.eventing.external.flatMap((p) => p.events);
const named = (events, name) => events.find((e) => e.name === name);

describe("Given returns and credit memos", () => {
  test("Then a return saved in Commerce runs order-commerce/return-saved, as a priority event", () => {
    expect(
      named(commerceEvents, "observer.rma_save_commit_after"),
    ).toMatchObject({
      priority: true,
      runtimeActions: ["order-commerce/return-saved"],
    });
  });

  test("Then the ERP's credit memo and return received events run their order-backoffice actions", () => {
    expect(
      named(externalEvents, "be-observer.sales_order_creditmemo_create")
        ?.runtimeActions,
    ).toEqual(["order-backoffice/creditmemo-created"]);
    expect(
      named(externalEvents, "be-observer.rma_status_update")?.runtimeActions,
    ).toEqual(["order-backoffice/return-updated"]);
  });

  test("Then each action is declared in its package, by the file it runs", () => {
    const external = readFileSync(
      `${ACTIONS}/external/actions.config.yaml`,
      "utf8",
    );
    const commerce = readFileSync(
      `${ACTIONS}/commerce/actions.config.yaml`,
      "utf8",
    );
    expect(external).toContain(
      "creditmemo-created:\n  function: creditmemo-created/index.js",
    );
    expect(external).toContain(
      "return-updated:\n  function: return-updated/index.js",
    );
    expect(commerce).toContain(
      "return-saved:\n  function: return-saved/index.js",
    );
  });

  test("Then the generated manifest carries the same events and version as the config", () => {
    expect(manifest.eventing).toEqual(
      JSON.parse(JSON.stringify(config.eventing)),
    );
    expect(manifest.metadata.version).toBe(config.metadata.version);
  });

  test("Then the app's version is bumped past the store's 0.10.0, so the upgrade subscribes the new events", () => {
    // 0.11.0 carried the return events; a later bump (0.12.0, AB-38's schedule settings)
    // still upgrades past the store's 0.10.0.
    const [major, minor] = config.metadata.version.split(".").map(Number);
    expect(major === 0 && minor >= 11).toBe(true);
  });

  test("Then the Admin history's Retry hands each event back to its own action", () => {
    expect(HANDLER_ACTIONS["credit-memo"]).toBe(
      "order-backoffice/creditmemo-created",
    );
    expect(HANDLER_ACTIONS.return).toBe("order-backoffice/return-updated");
  });
});
