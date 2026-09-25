vi.mock("#lib/erp-current", async (importOriginal) => ({
  ...(await importOriginal()),
  currentProducts: vi.fn(
    async () =>
      new Map([["S1", { warehouses: [{ code: "default", quantity: 4 }] }]]),
  ),
}));
vi.mock("#src/stock/external/updated/validator");

import { validateData } from "#src/stock/external/updated/validator";

vi.mock("#src/stock/external/updated/sender");

import {
  HTTP_BAD_REQUEST,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
} from "@adobe/aio-commerce-sdk/core/responses";

import * as action from "#src/stock/external/updated/index";
import { sendData } from "#src/stock/external/updated/sender";

describe("Given stock external updated action", () => {
  describe("When method main is defined", () => {
    test("Then is an instance of Function", () => {
      expect(action.main).toBeInstanceOf(Function);
    });
  });
  describe("When stock event data is invalid", () => {
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
      const IGNORED_PARAMS = {
        data: [
          { outOfStock: false, quantity: 1, sku: "S1", source: "default" },
        ],
      };
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
  describe("When stock event data is valid", () => {
    test("Then returns action success response", async () => {
      const IGNORED_PARAMS = {
        data: [
          { outOfStock: false, quantity: 1, sku: "S1", source: "default" },
        ],
      };
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
  describe("When the event carries a quantity the ERP has since changed", () => {
    test("Then Commerce is sent the ERP's quantity now", async () => {
      validateData.mockReturnValue({ success: true });
      sendData.mockReturnValue({ success: true });
      await action.main({
        data: [
          { outOfStock: false, quantity: 99, sku: "S1", source: "default" },
        ],
      });
      expect(sendData.mock.calls.at(-1)[1].sourceItems).toEqual([
        { quantity: 4, sku: "S1", source_code: "default", status: 1 },
      ]);
    });
  });
});
