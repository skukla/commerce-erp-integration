vi.mock("#src/stock/commerce-stock-api-client");
vi.mock("#lib/stock-snapshot", () => ({
  noteWritten: vi.fn(() => Promise.resolve()),
}));

import { noteWritten } from "#lib/stock-snapshot";
import { updateStock } from "#src/stock/commerce-stock-api-client";
import * as sender from "#src/stock/external/updated/sender";

describe("Given stock external updated sender", () => {
  describe("When method sendData is defined", () => {
    test("Then is an instance of Function", () => {
      expect(sender.sendData).toBeInstanceOf(Function);
    });
  });
  describe("When method sendData is called", () => {
    test("Then update stock is called", async () => {
      const params = {};
      const transformed = {};
      const preprocess = {};
      await sender.sendData(params, transformed, preprocess);
      expect(updateStock).toHaveBeenCalled();
    });
    // The minute refresh compares Commerce against its last read; what the ERP itself
    // wrote is noted as Commerce's quantity, or it would come straight back as a change.
    test("Then the written quantities are noted for the stock refresh, after Commerce took them", async () => {
      const sourceItems = [
        { quantity: 4, sku: "A1", source_code: "east", status: 1 },
      ];
      await sender.sendData({}, { sourceItems }, {});
      expect(noteWritten).toHaveBeenCalledWith(sourceItems);
    });
    test("Then a Commerce refusal notes nothing", async () => {
      noteWritten.mockClear();
      updateStock.mockRejectedValueOnce(new Error("refused"));
      const result = await sender.sendData({}, { sourceItems: [] }, {});
      expect(result.success).toBe(false);
      expect(noteWritten).not.toHaveBeenCalled();
    });
  });
});
