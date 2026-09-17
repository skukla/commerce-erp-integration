vi.mock("#src/order/commerce-order-api-client");
vi.mock("#lib/settings", () => ({
  settingsFor: vi.fn(async () => ({ orders_status_on_confirm: true })),
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
    test("Then a confirmation moves the order to Processing when its store's setting is on", async () => {
      getOrder.mockResolvedValueOnce({ store_id: 3 });
      const params = { data: { id: 99, status: "confirmed" } };
      await sender.sendData(params, LINE, {});
      expect(getOrder).toHaveBeenCalledWith(params, 99);
      expect(settingsFor).toHaveBeenCalledWith(3);
      expect(addComment).toHaveBeenCalledExactlyOnceWith(params, 99, {
        statusHistory: {
          comment: "Order confirmed in the ERP",
          status: "processing",
        },
      });
    });
    test("Then a confirmation adds the line alone when the setting is off", async () => {
      getOrder.mockResolvedValueOnce({ store_id: 3 });
      settingsFor.mockResolvedValueOnce({ orders_status_on_confirm: false });
      const params = { data: { id: 99, status: "confirmed" } };
      await sender.sendData(params, LINE, {});
      expect(addComment).toHaveBeenCalledExactlyOnceWith(params, 99, LINE);
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
