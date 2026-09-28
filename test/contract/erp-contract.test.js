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
const externalEvents = manifest.eventing.external.flatMap((p) => p.events);

function schemaOf(action) {
  try {
    return JSON.parse(readFileSync(`${ACTIONS}/${action}/schema.json`, "utf8"));
  } catch {
    return null; // handlers without a schema validate in code against the same keys
  }
}

/** The Commerce ids the ERP stopped holding at contract version 3. */
const COMMERCE_IDS = [
  "commerceCompanyId",
  "customerGroupId",
  "emailDomain",
  "website",
];

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

  test("Then the partner and stock imports, and the order request, use the ERP's field names", () => {
    // Demo Builder fills the ERP's products (its erpFillRows.ts); this app imports only a
    // company its event names (lib/company-sync.js) and a product's stock at every source.
    const partners = readFileSync("src/lib/company-sync.js", "utf8");
    for (const key of [
      "creditLimit",
      "websiteAccountClosed",
      "id",
      "name",
      "salesOrgs",
    ]) {
      expect(contract.import.partners).toContain(key);
      expect(partners).toContain(`${key}:`);
    }
    // Contract version 3: the ERP holds no Commerce id; the key map pairs them here.
    for (const key of COMMERCE_IDS) {
      expect(contract.import.partners).not.toContain(key);
      expect(partners).not.toContain(`${key}:`);
    }
    const commerce = readFileSync("src/lib/commerce.js", "utf8");
    for (const key of contract.import.warehouse) {
      expect(commerce).toContain(`${key}:`);
    }
    const stockSender = readFileSync(
      `${ACTIONS}/stock/commerce/updated/sender.js`,
      "utf8",
    );
    expect(contract.import.stock).toEqual(["sku", "warehouses"]);
    expect(stockSender).toContain("stock: [{ sku, warehouses:");
    const orderSync = readFileSync("src/lib/order-sync.js", "utf8");
    for (const key of [
      "commerceOrderId",
      "commerceIncrementId",
      "currency",
      "lines",
      "total",
    ]) {
      expect(contract.order.request).toContain(key);
      expect(orderSync).toContain(`${key}:`);
    }
    // The customer is named by the ERP's own number from the key map, and nothing else.
    expect(contract.order.request).toContain("partnerId");
    expect(orderSync).toContain("partnerId");
    for (const key of [...COMMERCE_IDS, "email"]) {
      expect(contract.order.request).not.toContain(key);
    }
    for (const key of contract.order.requestLine) {
      expect(orderSync).toContain(`${key}:`);
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
});
