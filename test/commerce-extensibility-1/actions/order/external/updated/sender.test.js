vi.mock("#src/order/commerce-order-api-client");
vi.mock("#lib/settings", () => ({
  settingsFor: vi.fn(async () => ({ orders_confirm_status: "erp_confirmed" })),
}));

import { settingsFor } from "#lib/settings";
import { addComment, getOrder } from "#src/order/commerce-order-api-client";
import * as sender from "#src/order/external/updated/sender";

const LINE = { statusHistory: { comment: "Order confirmed in the ERP" } };

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given order external updated sender", () => {
  describe("When method sendData is defined", () => {
    test("Then is an instance of Function", () => {
      expect(sender.sendData).toBeInstanceOf(Function);
    });
  });
  describe("When method sendData is called", () => {
    test("Then a status other than confirmed adds the line alone", async () => {
      const params = { data: { id: 99, status: "created" } };
      await sender.sendData(params, LINE, {});
      expect(addComment).toHaveBeenCalledExactlyOnceWith(params, 99, LINE);
      expect(getOrder).not.toHaveBeenCalled();
    });
    test("Then a confirmation sets the status the store's setting names", async () => {
      getOrder.mockResolvedValueOnce({ store_id: 3 });
      const params = { data: { id: 99, status: "confirmed" } };
      await sender.sendData(params, LINE, {});
      expect(getOrder).toHaveBeenCalledWith(params, 99);
      expect(settingsFor).toHaveBeenCalledWith(3);
      expect(addComment).toHaveBeenCalledExactlyOnceWith(params, 99, {
        statusHistory: {
          comment: "Order confirmed in the ERP",
          status: "erp_confirmed",
        },
      });
    });
    test("Then a confirmation adds the line alone when the setting is blank", async () => {
      getOrder.mockResolvedValueOnce({ store_id: 3 });
      settingsFor.mockResolvedValueOnce({ orders_confirm_status: "" });
      const params = { data: { id: 99, status: "confirmed" } };
      await sender.sendData(params, LINE, {});
      expect(addComment).toHaveBeenCalledExactlyOnceWith(params, 99, LINE);
    });
    test("Then a status Commerce refuses (400: not of the order's state) still leaves the note, and the delivery succeeds", async () => {
      // Measured 2026-09-25: `processing` on a pending order answers 400 "The status
      // \"processing\" is not part of the order status history".
      getOrder.mockResolvedValueOnce({ store_id: 3 });
      const refused = new Error(
        "Request failed with status code 400 Bad Request",
      );
      refused.response = { statusCode: 400 };
      addComment.mockRejectedValueOnce(refused);
      const params = { data: { id: 99, status: "confirmed" } };
      const result = await sender.sendData(params, LINE, {});
      expect(result.success).toBe(true);
      expect(result.message).toContain('did not take status "erp_confirmed"');
      expect(addComment).toHaveBeenCalledTimes(2);
      expect(addComment.mock.calls[1]).toEqual([params, 99, LINE]);
    });
    test("Then any other Commerce failure on the status is a failure to deliver again", async () => {
      getOrder.mockResolvedValueOnce({ store_id: 3 });
      addComment.mockRejectedValueOnce(new Error("Request timed out"));
      const result = await sender.sendData(
        { data: { id: 99, status: "confirmed" } },
        LINE,
        {},
      );
      expect(result).toStrictEqual({
        message: "Request timed out",
        statusCode: 500,
        success: false,
      });
      expect(addComment).toHaveBeenCalledTimes(1);
    });
    test("Then an unreadable order is a failure to deliver again", async () => {
      getOrder.mockRejectedValueOnce(new Error("Commerce is down"));
      const result = await sender.sendData(
        { data: { id: 99, status: "confirmed" } },
        LINE,
        {},
      );
      expect(result).toStrictEqual({
        message: "Commerce is down",
        statusCode: 500,
        success: false,
      });
      expect(addComment).not.toHaveBeenCalled();
    });
  });
});
