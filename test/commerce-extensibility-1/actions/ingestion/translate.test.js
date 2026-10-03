/*
 * The one translation module (AB-26y step 6): the ERP speaks its own language — CloudEvents
 * of its own types, its own records as data — and this app translates each into the
 * starter-kit event and the payload the order-backoffice, product, stock and company handlers
 * already take. Commerce's ids come from this app's own records and reads, never from the ERP.
 *
 * Every test asserts what would be PUBLISHED (event name and payload), not only that
 * something was.
 */

import { readFileSync } from "node:fs";

import Ajv from "ajv";

import {
  erpChangeOf,
  STARTER_KIT_EVENTS,
  TRANSLATIONS,
  translateErpEvent,
  validateCloudEvent,
} from "#src/ingestion/translate";

import contract from "../../../../contract/erp-contract.json" with {
  type: "json",
};
import manifest from "../../../../src/commerce-extensibility-1/.generated/app.commerce.manifest.json" with {
  type: "json",
};

const ENTITY_ID = 55;
const ORDER_NUMBER = "000000042";

/** Commerce's order by its number, as lib/commerce findOrderByIncrementId answers it. */
const findOrder = vi.fn(async (_params, incrementId) =>
  incrementId === ORDER_NUMBER
    ? { entityId: ENTITY_ID, extOrderId: "ERP-0000001000", storeId: 1 }
    : null,
);
const deps = { findOrder };

const envelope = (type, data, source = "/erp") => ({
  data,
  datacontenttype: "application/json",
  id: "4f1c0e7e-0000-4000-8000-000000000001",
  source,
  specversion: "1.0",
  time: "2026-10-02T10:00:00.000Z",
  type,
});

const ITEMS = [
  {
    CustomerLineReference: "1",
    Material: "A1",
    Quantity: 12,
    SalesOrderItem: 10,
  },
  {
    CustomerLineReference: "2",
    Material: "B2",
    Quantity: 4,
    SalesOrderItem: 20,
  },
];
const ORDER = {
  Items: ITEMS,
  PurchaseOrderByCustomer: ORDER_NUMBER,
  SalesOrder: "0000001000",
  SalesOrganization: "1000",
  SoldToParty: "C7",
  TransactionCurrency: "USD",
};
const HEAD = {
  erpNumber: "0000001000",
  id: ENTITY_ID,
  incrementId: ORDER_NUMBER,
  orderId: ENTITY_ID,
};
const OLD_ITEMS = [
  { orderItemId: 1, qty: 12, sku: "A1" },
  { orderItemId: 2, qty: 4, sku: "B2" },
];

const PRODUCT = {
  BaseUnit: "EA",
  ListPrice: 12,
  ParentProduct: null,
  Product: "A1",
  ProductName: "Trouser (ERP)",
  ProductType: "simple",
  SalesStatus: "sellable",
};

const translate = (type, data, source) =>
  translateErpEvent({}, envelope(type, data, source), deps);

afterEach(() => findOrder.mockClear());

describe("Given an ERP event in the ERP's own words", () => {
  test("When a sales order is confirmed, Then the order status update is published with Commerce's order id found by the customer's order number", async () => {
    const result = await translate("SalesOrder.Changed", {
      ...ORDER,
      CreditBlock: false,
      OverallStatus: "confirmed",
      PrevCreditBlock: false,
      PrevOverallStatus: "created",
      Reason: null,
    });
    expect(result).toEqual({
      erpId: undefined,
      events: [
        {
          event: "be-observer.sales_order_status_update",
          payload: {
            ...HEAD,
            items: OLD_ITEMS,
            notifyCustomer: false,
            status: "confirmed",
          },
        },
      ],
      ok: true,
    });
    expect(findOrder).toHaveBeenCalledWith({}, ORDER_NUMBER);
  });

  test("When a sales order is canceled, Then the cancel is published with the ERP's reason", async () => {
    const { events } = await translate("SalesOrder.Changed", {
      ...ORDER,
      CreditBlock: false,
      OverallStatus: "canceled",
      PrevCreditBlock: false,
      PrevOverallStatus: "confirmed",
      Reason: "Out of stock",
    });
    expect(events).toEqual([
      {
        event: "be-observer.sales_order_cancel",
        payload: {
          ...HEAD,
          items: OLD_ITEMS,
          notifyCustomer: false,
          reason: "Out of stock",
          status: "canceled",
        },
      },
    ]);
  });

  test("When a credit block goes on and then off, Then a hold and then a release are published; a reject is only a cancel", async () => {
    const held = await translate("SalesOrder.Changed", {
      ...ORDER,
      CreditBlock: true,
      OverallStatus: "created",
      PrevCreditBlock: false,
      PrevOverallStatus: null,
      Reason: "Credit limit USD 1,000.00 exceeded by USD 100.00",
    });
    expect(held.events).toEqual([
      {
        event: "be-observer.sales_order_hold",
        payload: {
          ...HEAD,
          held: true,
          items: OLD_ITEMS,
          notifyCustomer: false,
          reason: "Credit limit USD 1,000.00 exceeded by USD 100.00",
          status: "created",
        },
      },
    ]);
    const released = await translate("SalesOrder.Changed", {
      ...ORDER,
      CreditBlock: false,
      OverallStatus: "created",
      PrevCreditBlock: true,
      PrevOverallStatus: "created",
      Reason: null,
    });
    expect(
      released.events.map((e) => [e.event, e.payload.held, e.payload.reason]),
    ).toEqual([["be-observer.sales_order_hold", false, null]]);
    const rejected = await translate("SalesOrder.Changed", {
      ...ORDER,
      CreditBlock: true,
      OverallStatus: "canceled",
      PrevCreditBlock: true,
      PrevOverallStatus: "created",
      Reason: "Credit rejected",
    });
    expect(rejected.events.map((e) => e.event)).toEqual([
      "be-observer.sales_order_cancel",
    ]);
  });

  test("When a goods issue is posted, Then the shipment is published with THAT delivery's lines and its plant as the source", async () => {
    const { events } = await translate(
      "OutboundDelivery.GoodsIssueStatusChanged",
      {
        Carrier: null,
        GoodsMovementStatus: "posted",
        Items: [ITEMS[0]].map((i) => ({ ...i, Quantity: 5 })),
        OutboundDelivery: "8000000001",
        Plant: "east",
        PrevGoodsMovementStatus: "open",
        PurchaseOrderByCustomer: ORDER_NUMBER,
        SalesOrder: "0000001000",
        SoldToParty: "C7",
        TrackingNumber: null,
      },
    );
    expect(events).toEqual([
      {
        event: "be-observer.sales_order_shipment_create",
        payload: {
          ...HEAD,
          items: [{ orderItemId: 1, qty: 5, sku: "A1" }],
          notifyCustomer: false,
          status: "shipped",
          stockSourceCode: "east",
        },
      },
    ]);
  });

  const BILLING = {
    PurchaseOrderByCustomer: ORDER_NUMBER,
    SalesOrder: "0000001000",
    SoldToParty: "C7",
    TaxAmount: 3.2,
    TotalGrossAmount: 43.2,
    TotalNetAmount: 40,
    TransactionCurrency: "USD",
  };

  test("When an invoice is created, Then the invoice is published", async () => {
    const { events } = await translate("BillingDocument.Created", {
      ...BILLING,
      BillingDocument: "9000000001",
      BillingDocumentType: "Invoice",
      CustomerReturn: null,
      CustomerReturnReference: null,
      Items: ITEMS,
      ReferenceBillingDocument: null,
    });
    expect(events).toEqual([
      {
        event: "be-observer.sales_order_invoice_create",
        payload: {
          ...HEAD,
          items: OLD_ITEMS,
          notifyCustomer: false,
          status: "invoiced",
        },
      },
    ]);
  });

  test("When a credit memo credits a return, Then the credit memo is published naming the Commerce return the customer's reference is", async () => {
    const { events } = await translate("BillingDocument.Created", {
      ...BILLING,
      BillingDocument: "9500000001",
      BillingDocumentType: "CreditMemo",
      CustomerReturn: "6000000001",
      CustomerReturnReference: "12",
      Items: [ITEMS[0]].map((i) => ({ ...i, Quantity: 2 })),
      ReferenceBillingDocument: "9000000001",
      TotalGrossAmount: 27,
    });
    expect(events).toEqual([
      {
        event: "be-observer.sales_order_creditmemo_create",
        payload: {
          ...HEAD,
          commerceReturnId: 12,
          creditMemoNumber: "9500000001",
          items: [{ orderItemId: 1, qty: 2, sku: "A1" }],
          notifyCustomer: false,
          returnNumber: "6000000001",
          total: 27,
        },
      },
    ]);
  });

  test("When a credit memo credits a whole invoice, Then it names no return", async () => {
    const { events } = await translate("BillingDocument.Created", {
      ...BILLING,
      BillingDocument: "9500000002",
      BillingDocumentType: "CreditMemo",
      CustomerReturn: null,
      CustomerReturnReference: null,
      Items: ITEMS,
      ReferenceBillingDocument: "9000000001",
    });
    expect(events[0].payload).toMatchObject({
      commerceReturnId: null,
      returnNumber: null,
    });
  });

  test("When a return's goods are received, Then the return update is published", async () => {
    const { events } = await translate("CustomerReturn.Changed", {
      CustomerReturn: "6000000001",
      CustomerReturnReference: "12",
      Items: [ITEMS[1]].map((i) => ({ ...i, Quantity: 1 })),
      PrevStatus: "open",
      PurchaseOrderByCustomer: ORDER_NUMBER,
      SalesOrder: "0000001000",
      SoldToParty: "C7",
      Status: "received",
    });
    expect(events).toEqual([
      {
        event: "be-observer.rma_status_update",
        payload: {
          ...HEAD,
          commerceReturnId: 12,
          items: [{ orderItemId: 2, qty: 1, sku: "B2" }],
          returnNumber: "6000000001",
          status: "received",
        },
      },
    ]);
  });

  test("When a payment is posted, Then the payment is published", async () => {
    const { events } = await translate("IncomingPayment.Posted", {
      Amount: 50,
      BillingDocument: "9000000001",
      Currency: "USD",
      Customer: "C7",
      Payment: "7000000001",
      PaymentReference: "Check 1",
      PurchaseOrderByCustomer: ORDER_NUMBER,
      SalesOrder: "0000001000",
    });
    expect(events).toEqual([
      {
        event: "be-observer.sales_order_payment_create",
        payload: {
          ...HEAD,
          amount: 50,
          currency: "USD",
          invoiceNumber: "9000000001",
          partnerId: "C7",
          paymentNumber: "7000000001",
          reference: "Check 1",
        },
      },
    ]);
  });

  test("When a product's name or list price changed, Then the product update is published; a sales status alone publishes nothing", async () => {
    const changed = await translate("Product.Changed", {
      ...PRODUCT,
      ChangedFields: ["ProductName"],
    });
    expect(changed.events).toEqual([
      {
        event: "be-observer.catalog_product_update",
        payload: { name: "Trouser (ERP)", price: 12, sku: "A1" },
      },
    ]);
    const status = await translate("Product.Changed", {
      ...PRODUCT,
      ChangedFields: ["SalesStatus"],
    });
    expect(status).toEqual({ erpId: undefined, events: [], ok: true });
  });

  test("When one plant's stock changed, Then a stock update of that one source is published", async () => {
    const { events } = await translate("ProductStock.Changed", {
      Plant: "denver_dc",
      PrevQuantity: 3,
      Product: "T1",
      Quantity: 0,
    });
    expect(events).toEqual([
      {
        event: "be-observer.catalog_stock_update",
        payload: [
          { outOfStock: true, quantity: 0, sku: "T1", source: "denver_dc" },
        ],
      },
    ]);
  });

  const CUSTOMER = {
    CreditLimit: 250,
    Customer: "C7",
    CustomerName: "Northwind",
    PaymentTerms: "NET30",
    PriceGroup: null,
  };

  test("When a customer's credit limit and blocking level changed, Then the credit update and the folded block are published, in that order", async () => {
    const { events } = await translate("Customer.Changed", {
      ...CUSTOMER,
      BlockingLevel: "all",
      ChangedFields: ["CreditLimit", "BlockingLevel"],
      PrevBlockingLevel: "open",
    });
    expect(events).toEqual([
      {
        event: "be-observer.company_credit_update",
        payload: { creditLimit: 250, partnerId: "C7" },
      },
      {
        event: "be-observer.company_status_update",
        payload: { blocked: true, partnerId: "C7" },
      },
    ]);
  });

  test("When a blocking level moves between two levels that both block, Then nothing is published: Commerce knows only blocked or not", async () => {
    const between = await translate("Customer.Changed", {
      ...CUSTOMER,
      BlockingLevel: "invoicing",
      ChangedFields: ["BlockingLevel"],
      PrevBlockingLevel: "shipping",
    });
    expect(between.events).toEqual([]);
    const lifted = await translate("Customer.Changed", {
      ...CUSTOMER,
      BlockingLevel: "open",
      ChangedFields: ["BlockingLevel"],
      PrevBlockingLevel: "invoicing",
    });
    expect(lifted.events).toEqual([
      {
        event: "be-observer.company_status_update",
        payload: { blocked: false, partnerId: "C7" },
      },
    ]);
  });

  test("When a customer's prices in force changed, Then the contract update carries the whole set", async () => {
    const lines = [
      {
        appliesTo: "customer",
        contractNumber: "4000000001",
        kind: "price",
        minQty: 1,
        price: 8,
        salesOrg: null,
        sku: "A1",
      },
    ];
    const { events } = await translate("PriceList.Changed", {
      Customer: "C7",
      Lines: lines,
    });
    expect(events).toEqual([
      {
        event: "be-observer.company_contract_update",
        payload: { lines, partnerId: "C7" },
      },
    ]);
  });
});

describe("Given an ERP event's source", () => {
  test("When the source names an ERP, Then its id rides on every object payload, never on a stock list", async () => {
    const credit = await translate(
      "Customer.Changed",
      {
        BlockingLevel: "open",
        ChangedFields: ["CreditLimit"],
        CreditLimit: 9,
        Customer: "C7",
        PrevBlockingLevel: "open",
      },
      "/erp/brand-b",
    );
    expect(credit.erpId).toBe("brand-b");
    expect(credit.events[0].payload).toEqual({
      creditLimit: 9,
      erpId: "brand-b",
      partnerId: "C7",
    });
    const stock = await translate(
      "ProductStock.Changed",
      { Plant: "default", PrevQuantity: 1, Product: "A1", Quantity: 2 },
      "/erp/brand-b",
    );
    expect(stock.events[0].payload).toEqual([
      { outOfStock: false, quantity: 2, sku: "A1", source: "default" },
    ]);
  });
});

describe("Given what cannot be translated", () => {
  test("When the type is not one the ERP raises, Then the answer is 400 and nothing is published", async () => {
    expect(await translate("SalesOrder.Exploded", {})).toEqual({
      message: "unknown ERP event type SalesOrder.Exploded",
      ok: false,
      statusCode: 400,
    });
  });

  test("When Commerce has no order with the customer's order number yet, Then the answer is 503, so the ERP delivers it again", async () => {
    const result = await translate("SalesOrder.Changed", {
      ...ORDER,
      CreditBlock: false,
      OverallStatus: "confirmed",
      PrevCreditBlock: false,
      PrevOverallStatus: "created",
      PurchaseOrderByCustomer: "000000999",
    });
    expect(result).toEqual({
      message: "Commerce has no order 000000999 yet",
      ok: false,
      statusCode: 503,
    });
  });

  /*
   * Repeat order (ERP contract version 19): the ERP made a sales order of its own from a
   * canceled one. The web shop never had it, so it carries no customer reference, and nothing
   * about it is the web shop's to hear: no Commerce order is read, none is created, nothing is
   * published, and the answer ends the delivery (a 503 would have the ERP retry it in vain).
   */
  const ERP_OWN = {
    ...ORDER,
    Items: ITEMS.map((i) => ({ ...i, CustomerLineReference: null })),
    PurchaseOrderByCustomer: null,
  };
  test.each([
    [
      "SalesOrder.Changed",
      {
        ...ERP_OWN,
        CreditBlock: false,
        OverallStatus: "confirmed",
        PrevCreditBlock: false,
        PrevOverallStatus: "created",
        Reason: null,
      },
    ],
    [
      "SalesOrder.Changed",
      {
        ...ERP_OWN,
        CreditBlock: true,
        OverallStatus: "created",
        PrevCreditBlock: false,
        PrevOverallStatus: null,
        Reason: "Credit limit exceeded",
      },
    ],
    [
      "OutboundDelivery.GoodsIssueStatusChanged",
      {
        ...ERP_OWN,
        GoodsMovementStatus: "posted",
        OutboundDelivery: "8000000012",
        Plant: "east",
      },
    ],
    [
      "BillingDocument.Created",
      {
        ...ERP_OWN,
        BillingDocument: "9000000001",
        BillingDocumentType: "Invoice",
      },
    ],
    [
      "BillingDocument.Created",
      {
        ...ERP_OWN,
        BillingDocument: "9500000001",
        BillingDocumentType: "CreditMemo",
      },
    ],
    [
      "IncomingPayment.Posted",
      {
        ...ERP_OWN,
        Amount: 5,
        BillingDocument: "9000000001",
        Customer: "C7",
        Payment: "7000000001",
      },
    ],
  ])(
    "When a %s names no customer reference (an order the ERP made itself), Then nothing is published and Commerce is not read",
    async (type, data) => {
      const result = await translate(type, data);
      expect(result).toEqual({
        erpId: undefined,
        events: [],
        ok: true,
        skipped:
          "sales order 0000001000 was made in the ERP; the web shop has no order for it",
      });
      expect(findOrder).not.toHaveBeenCalled();
    },
  );

  /*
   * A document line the ERP cannot name by the customer's line reference (the order went to
   * the ERP without Commerce's item id for it) has no Commerce line to ship, invoice, credit
   * or receive. Dropping it turned "lines that could not be mapped" into "no lines", which
   * Commerce reads as the whole order. The whole document is refused instead, with a 400 the
   * ERP journals, naming the document and the line.
   */
  const unreferenced = (reference) => [
    ITEMS[0],
    { ...ITEMS[1], CustomerLineReference: reference },
  ];

  test.each([
    [null, "missing"],
    ["", "empty"],
    ["line-1", "not a number"],
  ])(
    "When a shipment line's customer line reference is %j (%s), Then the whole shipment is refused with a 400 naming the document and the line, Commerce is not read, and nothing is published",
    async (reference) => {
      const result = await translate(
        "OutboundDelivery.GoodsIssueStatusChanged",
        {
          GoodsMovementStatus: "posted",
          Items: unreferenced(reference),
          OutboundDelivery: "8000000012",
          Plant: "east",
          PurchaseOrderByCustomer: ORDER_NUMBER,
          SalesOrder: "0000001000",
        },
      );
      expect(result).toEqual({
        message:
          "Shipment 8000000012 line 20 names no web shop line; nothing was shipped in the web shop.",
        ok: false,
        statusCode: 400,
      });
      expect(findOrder).not.toHaveBeenCalled();
    },
  );

  test("When an invoice, a credit memo or a received return has a line with no reference, Then each is refused whole, in its own words", async () => {
    const billing = (type, number) =>
      translate("BillingDocument.Created", {
        BillingDocument: number,
        BillingDocumentType: type,
        Items: unreferenced(null),
        PurchaseOrderByCustomer: ORDER_NUMBER,
        SalesOrder: "0000001000",
      });
    expect(await billing("Invoice", "9000000001")).toEqual({
      message:
        "Invoice 9000000001 line 20 names no web shop line; nothing was invoiced in the web shop.",
      ok: false,
      statusCode: 400,
    });
    expect(await billing("CreditMemo", "9500000001")).toEqual({
      message:
        "Credit memo 9500000001 line 20 names no web shop line; nothing was credited in the web shop.",
      ok: false,
      statusCode: 400,
    });
    expect(
      await translate("CustomerReturn.Changed", {
        CustomerReturn: "6000000001",
        CustomerReturnReference: "12",
        Items: unreferenced(null),
        PurchaseOrderByCustomer: ORDER_NUMBER,
        SalesOrder: "0000001000",
        Status: "received",
      }),
    ).toEqual({
      message:
        "Return 6000000001 line 20 names no web shop line; nothing was received in the web shop.",
      ok: false,
      statusCode: 400,
    });
  });

  test("When a sales order change or a return that is not yet received has such a line, Then it is still translated: it acts on no line", async () => {
    const confirmed = await translate("SalesOrder.Changed", {
      ...ORDER,
      CreditBlock: false,
      Items: unreferenced("line-1"),
      OverallStatus: "confirmed",
      PrevCreditBlock: false,
      PrevOverallStatus: "created",
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.events[0].payload.items).toEqual([OLD_ITEMS[0]]);
    const approved = await translate("CustomerReturn.Changed", {
      CustomerReturn: "6000000001",
      Items: unreferenced(null),
      PurchaseOrderByCustomer: ORDER_NUMBER,
      SalesOrder: "0000001000",
      Status: "approved",
    });
    expect(approved).toMatchObject({ events: [], ok: true });
  });

  test("When the body is not a CloudEvent of version 1.0 from an ERP, Then it is refused, saying what is wrong", () => {
    expect(validateCloudEvent(envelope("SalesOrder.Changed", {}))).toEqual({
      success: true,
    });
    expect(
      validateCloudEvent({
        data: { event: "be-observer.x", uid: "1", value: {} },
      }),
    ).toEqual({
      message: "not a CloudEvent 1.0: missing specversion, id, source, type",
      success: false,
    });
    expect(
      validateCloudEvent({
        ...envelope("SalesOrder.Changed", {}),
        specversion: "0.3",
      }).success,
    ).toBe(false);
    expect(
      validateCloudEvent({
        ...envelope("SalesOrder.Changed", {}),
        source: "/shop",
      }),
    ).toEqual({
      message: "source /shop is not an ERP (/erp or /erp/<id>)",
      success: false,
    });
    expect(
      validateCloudEvent({ ...envelope("SalesOrder.Changed", null) }).success,
    ).toBe(false);
  });
});

/*
 * AB-26y step 5 (ERP contract version 19): which change of the integration's own an ERP event
 * would echo, in the words lib/own-writes.js records it by (sentToErp). Read here, the one
 * module that reads the ERP's words.
 */
describe("Given an ERP event that may echo a change this integration sent", () => {
  const change = (d) => ({
    ...ORDER,
    CreditBlock: false,
    PrevCreditBlock: false,
    Reason: null,
    ...d,
  });
  test.each([
    [
      "a cancel",
      "SalesOrder.Changed",
      change({ OverallStatus: "canceled", PrevOverallStatus: "created" }),
      { kind: "cancel", salesOrder: "0000001000" },
    ],
    [
      "a hold",
      "SalesOrder.Changed",
      change({
        CreditBlock: true,
        OverallStatus: "created",
        PrevOverallStatus: "created",
      }),
      { kind: "hold", salesOrder: "0000001000" },
    ],
    [
      "a release",
      "SalesOrder.Changed",
      change({
        OverallStatus: "created",
        PrevCreditBlock: true,
        PrevOverallStatus: "created",
      }),
      { kind: "release", salesOrder: "0000001000" },
    ],
    [
      "a confirmation (nothing this app sends)",
      "SalesOrder.Changed",
      change({ OverallStatus: "confirmed", PrevOverallStatus: "created" }),
      null,
    ],
    [
      "a goods issue, by its lines",
      "OutboundDelivery.GoodsIssueStatusChanged",
      { ...ORDER, OutboundDelivery: "8000000001" },
      {
        kind: "shipment",
        lines: [
          { customerLineReference: "1", qty: 12 },
          { customerLineReference: "2", qty: 4 },
        ],
        salesOrder: "0000001000",
      },
    ],
    [
      "an invoice",
      "BillingDocument.Created",
      { ...ORDER, BillingDocumentType: "Invoice" },
      { kind: "invoice", salesOrder: "0000001000" },
    ],
    [
      "a credit memo (nothing this app sends)",
      "BillingDocument.Created",
      { ...ORDER, BillingDocumentType: "CreditMemo" },
      null,
    ],
    [
      "a product change",
      "Product.Changed",
      { ChangedFields: ["ProductName"], Product: "A1" },
      null,
    ],
  ])(
    "When it is %s, Then the change it would echo is named",
    (_what, type, data, expected) => {
      expect(erpChangeOf(type, data)).toEqual(expected);
    },
  );
});

describe("Given the ERP contract and this app's subscriptions", () => {
  const external = manifest.eventing.external.flatMap((p) => p.events);

  test("Then every event type in the ERP's contract has exactly one translation, and nothing else does", () => {
    expect(Object.keys(TRANSLATIONS).sort()).toEqual(
      Object.keys(contract.events.types).sort(),
    );
  });

  test("Then every starter-kit event the translator publishes is one this app subscribes to, and every subscription is published by it", () => {
    expect([...STARTER_KIT_EVENTS].sort()).toEqual(
      external.map((e) => e.name).sort(),
    );
  });

  test("Then every payload the translator publishes validates against its handler's own schema", async () => {
    const FOLDERS = {
      "order-backoffice": "order/external",
      "product-backoffice": "product/external",
      "stock-backoffice": "stock/external",
    };
    const ajv = new Ajv();
    const samples = [
      translate("OutboundDelivery.GoodsIssueStatusChanged", {
        Items: ITEMS,
        Plant: "east",
        PurchaseOrderByCustomer: ORDER_NUMBER,
        SalesOrder: "0000001000",
      }),
      translate("SalesOrder.Changed", {
        ...ORDER,
        OverallStatus: "confirmed",
        PrevOverallStatus: "created",
      }),
      translate("Product.Changed", {
        ...PRODUCT,
        ChangedFields: ["ListPrice"],
      }),
      translate("ProductStock.Changed", {
        Plant: "default",
        PrevQuantity: 1,
        Product: "A1",
        Quantity: 2,
      }),
    ];
    let checked = 0;
    for (const { events } of await Promise.all(samples)) {
      for (const { event, payload } of events) {
        const [pkg, name] = external
          .find((e) => e.name === event)
          .runtimeActions[0].split("/");
        const schema = JSON.parse(
          readFileSync(
            `src/commerce-extensibility-1/actions/${FOLDERS[pkg]}/${name}/schema.json`,
            "utf8",
          ),
        );
        expect(ajv.validate(schema, payload), event).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBe(4);
  });
});
