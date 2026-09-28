/* The demo ERP adapter's readOutcome: each of the ERP's order messages as a part outcome. */
import { readOutcome } from "#adapters/demo-erp/index";

describe("Given a message from the demo ERP", () => {
  test.each([
    ["hold", { held: true, reason: "Credit" }, "held"],
    ["hold", { held: false }, "sent"],
    ["cancel", { reason: "Duplicate" }, "cancelled"],
    ["invoice", {}, "invoiced"],
    ["shipment", {}, "shipped"],
    ["order-status", { status: "confirmed" }, "confirmed"],
    ["order-status", { status: "canceled" }, "cancelled"],
  ])("Then %s %j reads as %s", (type, data, outcome) => {
    const read = readOutcome({
      data: { erpNumber: "0000001003", ...data },
      type,
    });
    expect(read).toMatchObject({ erpNumber: "0000001003", outcome });
    expect(typeof read.message).toBe("string");
  });

  test("Then a message it does not know is not about a part", () => {
    expect(readOutcome({ data: {}, type: "price" })).toBeNull();
  });
});
