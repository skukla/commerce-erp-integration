/*
 * The pin between the two repositories. The ERP's contract is vendored here; these tests
 * fail when this integration subscribes to an event the ERP does not raise, handles a
 * payload with keys the ERP does not send, calls a route the ERP does not serve, or sends
 * an import, quote or order the ERP would not understand. `npm run contract:check` says
 * when the vendored copy is behind the ERP's main.
 */
import { readdirSync, readFileSync } from "node:fs";

import { paymentReferenceOf } from "#lib/payment-reference";
import {
  STARTER_KIT_EVENTS,
  TRANSLATIONS,
  validateCloudEvent,
} from "#src/ingestion/translate";

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

/** A DELETE sent to the ERP's products route: gone at contract version 17. */
const NO_PAYMENT_EVENT = /NO IncomingPayment\.Posted/u;
const PRODUCT_DELETE_CALL = /erpRequest\(params, "products", \{[^}]*DELETE/u;

/** Commerce's names the ERP stopped accepting at contract version 16. */
const COMMERCE_NAMES_ON_THE_WIRE =
  /commerce(?:Shipment|Invoice|Order|Return)Id:|commerceIncrementId:|commerce-(?:shipment|invoice)/u;

/** The Commerce ids the ERP stopped holding at contract version 3. */
const COMMERCE_IDS = [
  "commerceCompanyId",
  "customerGroupId",
  "emailDomain",
  "website",
];

describe("Given the ERP contract", () => {
  // Contract version 16: the ERP speaks its own language, and the one translation module
  // (#src/ingestion/translate) says what each of its types means here. The handlers'
  // subscriptions are the starter-kit events that module publishes.
  test("Then every ERP event type has a translation, and every subscription is an event a translation publishes", () => {
    expect(Object.keys(TRANSLATIONS).sort()).toEqual(
      Object.keys(contract.events.types).sort(),
    );
    expect(externalEvents.map((e) => e.name).sort()).toEqual(
      [...STARTER_KIT_EVENTS].sort(),
    );
    for (const e of externalEvents) {
      expect(e.runtimeActions).toHaveLength(1);
      expect(FOLDERS[e.runtimeActions[0].split("/")[0]]).toBeDefined();
    }
  });

  test("Then the translation reads only data keys the ERP's contract lists for each type", () => {
    const source = readFileSync(`${ACTIONS}/ingestion/translate.js`, "utf8");
    const read = new Set(
      [...source.matchAll(/\bd\.([A-Z][A-Za-z]+)/gu)].map((m) => m[1]),
    );
    const listed = new Set([
      ...Object.values(contract.events.types).flatMap((t) => t.data),
      ...contract.events.item,
    ]);
    expect(read.size).toBeGreaterThan(10);
    for (const key of read) {
      expect([...listed], key).toContain(key);
    }
  });

  // Contract version 17: the ERP has no product delete (AB-26y step 5), and an order line
  // may carry the discount Commerce took off it (AB-16l).
  test("Then from version 17 this app deletes no ERP product, and the order event asks for each line's discount", () => {
    expect(contract.contractVersion).toBeGreaterThanOrEqual(17);
    expect(contract.routes.products.join(" ")).not.toContain("DELETE");
    const erpClient = readFileSync("src/lib/erp.js", "utf8");
    expect(erpClient).not.toContain("deleteProduct");
    expect(erpClient).not.toMatch(PRODUCT_DELETE_CALL);
    expect(contract.order.requestLine).toContain("discount");
    const orderSaved = manifest.eventing.commerce
      .flatMap((provider) => provider.events)
      .find((e) => e.name === "observer.sales_order_save_commit_after");
    expect(orderSaved.fields.map((f) => f.name)).toContain(
      "items[].base_discount_amount",
    );
  });

  // Contract version 18 (AB-26s, the card half): an order paid at checkout carries the
  // payment reference, built from an allow-list (lib/payment-reference.js), and the ERP raises
  // no payment event for the payment it posts with that order's invoice.
  test("Then the contract is at version 18: the order request carries the payment reference this app builds", () => {
    expect(contract.contractVersion).toBe(18);
    expect(contract.order.request).toContain("payment");
    const built = paymentReferenceOf({
      base_amount_paid: 10,
      cc_last4: "4242",
      cc_type: "VI",
      last_trans_id: "TX1",
      method: "card",
    });
    expect(Object.keys(built).sort()).toStrictEqual(
      [...contract.order.payment].sort(),
    );
    expect(contract.payments.paidInWebShopNote).toMatch(NO_PAYMENT_EVENT);
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
      "purchaseOrderByCustomer",
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

  test("Then the ingestion webhook expects the body the ERP sends: a CloudEvent", () => {
    expect(contract.delivery.envelope).toEqual([
      "specversion",
      "id",
      "source",
      "type",
      "time",
      "datacontenttype",
      "data",
    ]);
    const body = Object.fromEntries(
      contract.delivery.envelope.map((key) => [key, key === "data" ? {} : "x"]),
    );
    expect(
      validateCloudEvent({ ...body, source: "/erp", specversion: "1.0" }),
    ).toEqual({ success: true });
    expect(readdirSync(`${ACTIONS}/ingestion`)).toContain("webhook");
  });

  test("Then what this app sends the ERP for a move made in Commerce uses the ERP's names, and no Commerce name", () => {
    const { external } = contract.order;
    const client = readFileSync("src/lib/erp.js", "utf8");
    expect(contract.routes.orders).toContain("POST /:number/external-shipment");
    expect(contract.routes.orders).toContain("POST /:number/external-invoice");
    expect(client).toContain("/external-shipment");
    expect(client).toContain("/external-invoice");
    const changes = readFileSync("src/lib/commerce-changes.js", "utf8");
    for (const key of [
      ...external.externalShipment,
      ...external.externalShipmentLine,
    ]) {
      expect(changes).toContain(`${key}`);
    }
    expect(changes).toContain(external.cancelReasonFromWebShop);
    const returns = readFileSync("src/router/return-pieces.js", "utf8");
    for (const key of [
      ...contract.returns.request,
      ...contract.returns.requestLine,
    ]) {
      expect(returns).toContain(`${key}`);
    }
    for (const text of [client, changes, returns]) {
      expect(text).not.toMatch(COMMERCE_NAMES_ON_THE_WIRE);
    }
  });
});
