vi.mock("#lib/erp-current", async (importOriginal) => ({
  ...(await importOriginal()),
  currentProduct: vi.fn(async () => ({
    listPrice: 10,
    name: "Now",
    type: "simple",
  })),
}));
vi.mock("#src/product/external/updated/validator");

import { validateData } from "#src/product/external/updated/validator";

vi.mock("#src/product/external/updated/sender");

import {
  HTTP_BAD_REQUEST,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
} from "@adobe/aio-commerce-sdk/core/responses";

import * as action from "#src/product/external/updated/index";
import { sendData } from "#src/product/external/updated/sender";

describe("Given product external updated action", () => {
  describe("When method main is defined", () => {
    test("Then is an instance of Function", () => {
      expect(action.main).toBeInstanceOf(Function);
    });
  });
  describe("When product event data is invalid", () => {
    test("Then returns action error response", async () => {
      const IGNORED_PARAMS = { data: {} };
      const FAILED_VALIDATION_RESPONSE = {
        message: "Data provided does not validate with the schema",
        success: false,
      };
      const ERROR_RESPONSE = {
        error: {
          body: { message: "Data provided does not validate with the schema" },
          statusCode: HTTP_BAD_REQUEST,
        },
        type: "error",
      };
      validateData.mockReturnValue(FAILED_VALIDATION_RESPONSE);
      expect(await action.main(IGNORED_PARAMS)).toMatchObject(ERROR_RESPONSE);
    });
  });
  describe("When an exception is thrown", () => {
    test("Then return action error response", async () => {
      const IGNORED_PARAMS = { data: {} };
      const SUCCESSFUL_VALIDATION_RESPONSE = {
        success: true,
      };
      const ERROR = new Error("generic error");
      const ERROR_RESPONSE = {
        error: {
          body: { message: ERROR.message },
          statusCode: HTTP_INTERNAL_SERVER_ERROR,
        },
        type: "error",
      };
      validateData.mockReturnValue(SUCCESSFUL_VALIDATION_RESPONSE);
      sendData.mockRejectedValue(ERROR);
      expect(await action.main(IGNORED_PARAMS)).toMatchObject(ERROR_RESPONSE);
    });
  });
  describe("When product event data is valid", () => {
    test("Then returns action success response", async () => {
      const IGNORED_PARAMS = { data: {} };
      const SUCCESSFUL_VALIDATION_RESPONSE = {
        success: true,
      };
      const SUCCESSFUL_SEND_DATA_RESPONSE = {
        response: "anything",
        success: true,
      };
      const SUCCESS_RESPONSE = { statusCode: HTTP_OK, type: "success" };
      validateData.mockReturnValue(SUCCESSFUL_VALIDATION_RESPONSE);
      sendData.mockReturnValue(SUCCESSFUL_SEND_DATA_RESPONSE);
      expect(await action.main(IGNORED_PARAMS)).toMatchObject(SUCCESS_RESPONSE);
    });
  });
  describe("When the event carries values the ERP has since changed", () => {
    test("Then Commerce is sent what the ERP holds now", async () => {
      validateData.mockReturnValue({ success: true });
      sendData.mockReturnValue({ success: true });
      await action.main({ data: { name: "Old name", price: 55, sku: "S1" } });
      expect(sendData.mock.calls.at(-1)[1]).toEqual({
        product: { name: "Now", price: 10, sku: "S1" },
      });
    });
    test("Then a SKU the ERP no longer has is refused, not written", async () => {
      const { currentProduct } = await import("#lib/erp-current");
      currentProduct.mockResolvedValueOnce(null);
      validateData.mockReturnValue({ success: true });
      sendData.mockClear();
      const response = await action.main({ data: { price: 1, sku: "GONE" } });
      expect(response).toMatchObject({
        error: { statusCode: HTTP_BAD_REQUEST },
      });
      expect(sendData).not.toHaveBeenCalled();
    });
  });
});
