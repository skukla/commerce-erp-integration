/* What the "Follow an order" section says: the headline, and one row per step. */
import { traceHeadline, traceRow } from "#web/trace-view.js";

describe("Given one order's trace", () => {
  test("Then the headline answers where the order is, on both sides", () => {
    expect(
      traceHeadline(
        {
          commerceStatus: "processing",
          erpNumber: "0000001042",
          erpStatus: "shipped",
          incrementId: "000000042",
          reachedErp: true,
        },
        "Northwind ERP",
      ),
    ).toBe(
      "Order 000000042 is Northwind ERP order 0000001042: shipped there, processing in Commerce.",
    );
  });

  test("Then an order still waiting says so plainly", () => {
    expect(
      traceHeadline(
        { erpNumber: null, incrementId: "000000042", reachedErp: false },
        "Northwind ERP",
      ),
    ).toBe("Order 000000042 has not reached Northwind ERP.");
  });

  // The ERP has the order — its number was written back — but did not answer just now.
  test("Then an ERP that did not answer is not the same as an order it never got", () => {
    expect(
      traceHeadline(
        {
          erpNumber: "0000001042",
          incrementId: "000000042",
          reachedErp: false,
        },
        "Northwind ERP",
      ),
    ).toContain("which Northwind ERP did not answer for");
  });

  test("Then no such order is said, not guessed at", () => {
    expect(traceHeadline({ incrementId: null }, "Northwind ERP")).toBe(
      "No order with that number.",
    );
    expect(traceHeadline(undefined, "Northwind ERP")).toBe(
      "No order with that number.",
    );
  });

  test("Then a step reads as where it happened and what happened", () => {
    expect(
      traceRow(
        {
          at: "2026-09-20T09:00:25Z",
          what: "Sent to Northwind ERP",
          where: "integration",
        },
        1,
      ),
    ).toStrictEqual({
      at: "2026-09-20T09:00:25Z",
      detail: "",
      failed: false,
      key: "1-2026-09-20T09:00:25Z",
      retry: null,
      tries: "",
      what: "Sent to Northwind ERP",
      where: "Integration",
    });
  });

  test("Then a step that did not get through carries its retry and its tries", () => {
    const row = traceRow(
      {
        at: "2026-09-20T09:00:25Z",
        detail: "order 000000042 is waiting for the ERP.",
        outcome: "held",
        retry: { incrementId: "000000042" },
        tries: 4,
        what: "Waiting for Northwind ERP",
        where: "integration",
      },
      0,
    );

    expect(row).toMatchObject({
      failed: true,
      retry: { incrementId: "000000042" },
      tries: "4 tries",
    });
  });

  test("Then a Commerce that did not answer is said first, and the ERP half still stands", () => {
    expect(
      traceHeadline(
        {
          commerceAnswered: false,
          commerceStatus: null,
          erpNumber: "0000001042",
          erpStatus: "confirmed",
          incrementId: "000000042",
          reachedErp: true,
        },
        "Northwind ERP",
      ),
    ).toBe(
      "Commerce did not answer, so its part of this order is missing. " +
        "Order 000000042 is Northwind ERP order 0000001042: confirmed there.",
    );
  });
});
