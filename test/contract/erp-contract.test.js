/*
 * The pin between the two repositories. The ERP's contract is vendored here; these tests
 * fail when this integration subscribes to an event the ERP does not raise, handles a
 * payload with keys the ERP does not send, calls a route the ERP does not serve, or sends
 * an import, quote or order the ERP would not understand. `npm run contract:check` says
 * when the vendored copy is behind the ERP's main.
 */
import { readdirSync, readFileSync } from "node:fs";

import contract from "../../contract/erp-contract.json" with { type: "json" };
import manifest from "../../src/commerce-extensibility-1/.generated/app.commerce.manifest.json" with {
  type: "json",
};

const ACTIONS = "src/commerce-extensibility-1/actions";
const FOLDERS = {
  "company-backoffice": "company/external",
  "order-backoffice": "order/external",
  "product-backoffice": "product/external",
  "stock-backoffice": "stock/external",
};
const ERP_ROUTE_CALL = /erpRequest\(params, "([a-z]+)"/gu;
const SYNC_STEP_VALUE = /(?:state|phase): "([a-z]+)"/gu;
const externalEvents = manifest.eventing.external.flatMap((p) => p.events);

function schemaOf(action) {
  try {
    return JSON.parse(readFileSync(`${ACTIONS}/${action}/schema.json`, "utf8"));
  } catch {
    return null; // handlers without a schema validate in code against the same keys
  }
}

describe("Given the ERP contract", () => {
  test("Then every ERP event this app subscribes to is one the ERP raises, and every raised event has a subscriber", () => {
    const subscribed = externalEvents.map((e) => e.name).sort();
    expect(subscribed).toEqual(Object.keys(contract.events).sort());
    for (const e of externalEvents) {
      expect(e.runtimeActions).toHaveLength(1);
    }
  });

  test("Then each handler's schema asks only for keys the ERP sends", () => {
    for (const e of externalEvents) {
      const [pkg, name] = e.runtimeActions[0].split("/");
      const schema = schemaOf(`${FOLDERS[pkg]}/${name}`);
      if (!schema) {
        continue;
      }
      const spec = contract.events[e.name];
      const props =
        schema.type === "array"
          ? Object.keys(schema.items.properties)
          : Object.keys(schema.properties);
      for (const key of props) {
        expect(spec.value, `${e.name}: ${key}`).toContain(key);
      }
      expect(schema.type === "array").toBe(Boolean(spec.valueIsArray));
    }
  });

  test("Then the ERP routes this app calls are routes the ERP serves", () => {
    const erpClient = readFileSync("src/lib/erp.js", "utf8");
    const called = [...erpClient.matchAll(ERP_ROUTE_CALL)].map((m) => m[1]);
    expect(called.length).toBeGreaterThan(0);
    for (const route of new Set(called)) {
      expect(Object.keys(contract.routes), route).toContain(route);
    }
    expect(erpClient).not.toContain('"outbox"');
  });

  test("Then the import rows, quote request and order request use the ERP's field names", () => {
    const mirror = readFileSync("src/lib/mirror.js", "utf8");
    for (const key of ["sku", "name", "listPrice", "warehouses"]) {
      expect(contract.import.products).toContain(key);
      expect(mirror).toContain(`${key}:`);
    }
    for (const key of contract.import.warehouse) {
      expect(mirror).toContain(`${key}:`);
    }
    for (const key of [
      "commerceCompanyId",
      "customerGroupId",
      "emailDomain",
      "creditLimit",
      "blocked",
      "id",
      "name",
    ]) {
      expect(contract.import.partners).toContain(key);
      expect(mirror).toContain(`${key}:`);
    }
    const webhook = readFileSync("src/lib/webhook.js", "utf8");
    for (const key of [
      "commerceOrderId",
      "commerceIncrementId",
      "currency",
      "lines",
      "total",
    ]) {
      expect(contract.order.request).toContain(key);
      expect(webhook).toContain(`${key}:`);
    }
    // the partner hints are spread in from partnerHints(), which names them in shorthand
    for (const key of ["customerGroupId", "customerId", "email"]) {
      expect(webhook).toMatch(new RegExp(`\\b${key}[,:]`, "u"));
    }
    expect(contract.order.request).toEqual(
      expect.arrayContaining(["customerGroupId", "email"]),
    );
    for (const key of contract.order.requestLine) {
      expect(webhook).toContain(`${key}:`);
    }
  });

  test("Then the ingestion webhook expects the body the ERP sends", () => {
    const validator = readFileSync(
      `${ACTIONS}/ingestion/webhook/validator.js`,
      "utf8",
    );
    for (const key of contract.delivery.body.data) {
      expect(validator).toContain(`data.${key}`);
    }
    expect(readdirSync(`${ACTIONS}/ingestion`)).toContain("webhook");
  });

  test("Then the ERP's Sync records reaches this app's mirror in background mode", async () => {
    const { MIRROR_JOB } = await import("#src/erp/mirror/index");
    expect(contract.sync).toEqual({
      answers: 202,
      description: expect.any(String),
      method: "POST",
      path: "/api/v1/web/erp/mirror?background=true",
      status: expect.any(Object),
    });
    expect(readdirSync(`${ACTIONS}/erp`)).toEqual(
      expect.arrayContaining(["mirror", MIRROR_JOB.split("/")[1]]),
    );
  });

  test("Then every sync step this app reports is one the ERP records", () => {
    const { routes, sync } = contract;
    expect(routes.admin).toContain("POST /sync");
    const erpClient = readFileSync("src/lib/erp.js", "utf8");
    expect(erpClient).toContain('path: "/sync"');
    // The states and phases the mirror sends.
    const mirrorSource =
      readFileSync("src/lib/mirror.js", "utf8") +
      readFileSync("src/lib/mirror-run.js", "utf8") +
      readFileSync(`${ACTIONS}/erp/mirror/index.js`, "utf8");
    const sent = new Set(
      [...mirrorSource.matchAll(SYNC_STEP_VALUE)].map((m) => m[1]),
    );
    for (const value of sent) {
      expect([...sync.status.states, ...sync.status.phases]).toContain(value);
    }
    expect(sent.size).toBeGreaterThan(3);
  });
});
