import { CommerceSdkValidationError } from "@adobe/aio-commerce-sdk/core/error";

vi.mock("@adobe/aio-lib-core-logging", () => ({
  default: vi.fn(),
}));

import AioLogger from "@adobe/aio-lib-core-logging";

vi.mock("@adobe/aio-commerce-lib-app", () => ({ publishEvent: vi.fn() }));

import { publishEvent } from "@adobe/aio-commerce-lib-app";

vi.mock("@adobe/aio-commerce-sdk/events/io-events", () => ({
  createAdobeIoEventsApiClient: vi.fn(() => ({ id: "events-client" })),
}));

import { createAdobeIoEventsApiClient } from "@adobe/aio-commerce-sdk/events/io-events";

vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({ ims: "auth" })),
}));

import { resolveImsAuthParams } from "@adobe/aio-commerce-sdk/auth";

import * as action from "#src/ingestion/webhook/index";

const mockLoggerInstance = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};
AioLogger.mockReturnValue(mockLoggerInstance);

afterEach(() => {
  vi.clearAllMocks();
});

vi.mock("#lib/commerce", () => ({
  findOrderByIncrementId: vi.fn(async (_p, incrementId) =>
    incrementId === "000000042" ? { entityId: 55 } : null,
  ),
}));

/* An ERP event as the ERP delivers it (its contract version 16): a CloudEvent in its words. */
const erpEvent = {
  data: {
    BaseUnit: "EA",
    ChangedFields: ["ProductName", "ListPrice"],
    ListPrice: 52,
    ParentProduct: null,
    Product: "TEST_WEBHOOK_2",
    ProductName: "Test webhook test",
    ProductType: "simple",
    SalesStatus: "sellable",
  },
  datacontenttype: "application/json",
  id: "e-1",
  source: "/erp/brand-b",
  specversion: "1.0",
  time: "2026-10-02T10:00:00.000Z",
  type: "Product.Changed",
};

describe("Given external backoffice events ingestion webhook", () => {
  describe("When method main is defined", () => {
    test("Then is an instance of Function", () => {
      expect(action.main).toBeInstanceOf(Function);
    });
  });

  describe("When an ERP event arrives in the ERP's own words", () => {
    test("Then the translated starter-kit event is published, with the translated payload", async () => {
      publishEvent.mockResolvedValueOnce(undefined);

      const response = await action.main(erpEvent);

      expect(createAdobeIoEventsApiClient).toHaveBeenCalledWith({
        auth: { ims: "auth" },
      });
      expect(resolveImsAuthParams).toHaveBeenCalled();
      expect(publishEvent).toHaveBeenCalledTimes(1);
      expect(publishEvent).toHaveBeenCalledWith({
        client: { id: "events-client" },
        event: "be-observer.catalog_product_update",
        payload: {
          erpId: "brand-b",
          name: "Test webhook test",
          price: 52,
          sku: "TEST_WEBHOOK_2",
        },
        provider: "erp",
      });
      expect(response).toEqual({
        body: {
          published: ["be-observer.catalog_product_update"],
          response: {
            message: "Event published successfully",
            success: true,
          },
          type: "Product.Changed",
        },
        statusCode: 200,
        type: "success",
      });
    });

    test("Then one ERP change that means two things to Commerce publishes both, in order", async () => {
      const response = await action.main({
        ...erpEvent,
        data: {
          BlockingLevel: "all",
          ChangedFields: ["CreditLimit", "BlockingLevel"],
          CreditLimit: 250,
          Customer: "C7",
          PrevBlockingLevel: "open",
        },
        type: "Customer.Changed",
      });
      expect(response.statusCode).toBe(200);
      expect(
        publishEvent.mock.calls.map(([c]) => [c.event, c.payload]),
      ).toEqual([
        [
          "be-observer.company_credit_update",
          { creditLimit: 250, erpId: "brand-b", partnerId: "C7" },
        ],
        [
          "be-observer.company_status_update",
          { blocked: true, erpId: "brand-b", partnerId: "C7" },
        ],
      ]);
    });

    test("Then a change that means nothing to Commerce publishes nothing and answers 200", async () => {
      const response = await action.main({
        ...erpEvent,
        data: { ...erpEvent.data, ChangedFields: ["SalesStatus"] },
      });
      expect(publishEvent).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(200);
      expect(response.body.published).toEqual([]);
    });
  });

  describe("When the event cannot be translated", () => {
    test("Then an unknown type answers 400, is logged, and publishes nothing", async () => {
      const response = await action.main({
        ...erpEvent,
        type: "Thing.Happened",
      });
      expect(publishEvent).not.toHaveBeenCalled();
      expect(response).toEqual({
        error: {
          body: { message: "unknown ERP event type Thing.Happened" },
          statusCode: 400,
        },
        type: "error",
      });
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        "ERP event e-1 not translated: unknown ERP event type Thing.Happened",
      );
    });

    test("Then an order Commerce cannot find yet answers 503, so the ERP delivers it again", async () => {
      const response = await action.main({
        ...erpEvent,
        data: {
          CreditBlock: false,
          Items: [],
          OverallStatus: "confirmed",
          PrevCreditBlock: false,
          PrevOverallStatus: "created",
          PurchaseOrderByCustomer: "000000999",
          SalesOrder: "0000001000",
        },
        type: "SalesOrder.Changed",
      });
      expect(publishEvent).not.toHaveBeenCalled();
      expect(response.error.statusCode).toBe(503);
    });
  });

  describe("When received data information is invalid", () => {
    test("Then the old body, a starter-kit event name and value, is refused", async () => {
      const response = await action.main({
        data: {
          event: "be-observer.catalog_product_update",
          uid: "1",
          value: {},
        },
      });

      expect(publishEvent).not.toHaveBeenCalled();
      expect(response).toEqual({
        error: {
          body: {
            message:
              "not a CloudEvent 1.0: missing specversion, id, source, type",
          },
          statusCode: 400,
        },
        type: "error",
      });
    });
  });

  describe("When publishing the event fails", () => {
    test("Then returns error response", async () => {
      publishEvent.mockRejectedValueOnce(new Error("fake error"));

      const response = await action.main(erpEvent);

      expect(response).toEqual({
        error: {
          body: { message: "fake error" },
          statusCode: 500,
        },
        type: "error",
      });
    });

    test("Then logs the details of a CommerceSdkValidationError", async () => {
      publishEvent.mockRejectedValueOnce(
        new CommerceSdkValidationError("Invalid event data", { issues: [] }),
      );

      const response = await action.main(erpEvent);

      expect(response).toEqual({
        error: {
          body: { message: "Invalid event data" },
          statusCode: 500,
        },
        type: "error",
      });
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        "Server error: Invalid event data",
      );
    });
  });
});
