/*
 * The ERP's payment event (AB-26s, contract v14) is registered everywhere a handler must be to
 * run: the external event in app.commerce.config.ts, the action in its package, the generated
 * manifest the running actions read, the Admin history's Retry and label, and a version bump,
 * without which App Management never subscribes the new event on an installed store.
 */
import { readFileSync } from "node:fs";

import { HANDLER_ACTIONS } from "#lib/erp-event-history";

import config from "../app.commerce.config.ts";
import manifest from "../src/commerce-extensibility-1/.generated/app.commerce.manifest.json" with {
  type: "json",
};

const externalEvents = config.eventing.external.flatMap((p) => p.events);

describe("Given the ERP's payment event", () => {
  test("Then it runs order-backoffice/payment-received", () => {
    expect(
      externalEvents.find(
        (e) => e.name === "be-observer.sales_order_payment_create",
      )?.runtimeActions,
    ).toEqual(["order-backoffice/payment-received"]);
  });

  test("Then the action is declared in its package, by the file it runs", () => {
    expect(
      readFileSync(
        "src/commerce-extensibility-1/actions/order/external/actions.config.yaml",
        "utf8",
      ),
    ).toContain("payment-received:\n  function: payment-received/index.js");
  });

  test("Then the generated manifest carries the same events and version as the config", () => {
    expect(manifest.eventing).toEqual(
      JSON.parse(JSON.stringify(config.eventing)),
    );
    expect(manifest.metadata.version).toBe(config.metadata.version);
  });

  test("Then the app's version is 0.13.0, past 0.12.0, so the upgrade subscribes the payment event", () => {
    expect(config.metadata.version).toBe("0.13.0");
  });

  test("Then the Admin history's Retry hands the event back to its own action", () => {
    expect(HANDLER_ACTIONS.payment).toBe("order-backoffice/payment-received");
  });
});
