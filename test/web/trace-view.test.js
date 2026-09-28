/* What the "Follow an order" section says: the headline, and one row per step. */
import {
  traceHeadline,
  traceRow,
  traceSummary,
} from "#web/trace-view.js";

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
      resend: null,
      retry: null,
      tone: "ok",
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
      resend: null,
      retry: { incrementId: "000000042" },
      tone: "warn",
      tries: "4 tries",
    });
  });

  // A split order's waiting part is re-sent as that part (erp/resend-part), not the whole order.
  test("Then a part that waits offers Re-send this part, by its ERP", () => {
    const row = traceRow(
      {
        at: "2026-09-28T14:52:00Z",
        outcome: "held",
        retry: { erpId: "contoso", incrementId: "3000000024" },
        what: "Waiting for Contoso ERP",
        where: "integration",
      },
      2,
    );
    expect(row).toMatchObject({
      resend: { erpId: "contoso", incrementId: "3000000024" },
      retry: null,
    });
    expect(
      traceRow({ at: "T", outcome: "refused", what: "x", where: "erp" }, 0)
        .tone,
    ).toBe("bad");
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

  // Several ERPs: one order in parts, so no one ERP's name or number can answer for it.
  test("Then a split order's headline names each ERP's part, and the one still waiting", () => {
    expect(
      traceHeadline(
        {
          commerceStatus: "processing",
          erpNumber: "0000001000",
          erpStatus: "created",
          erps: [
            {
              name: "Northwind ERP",
              number: "0000001000",
              part: "sent",
              status: "created",
            },
            { name: "Contoso ERP", number: null, part: "held", status: null },
          ],
          incrementId: "3000000022",
          reachedErp: true,
        },
        "Northwind ERP",
      ),
    ).toBe(
      "Order 3000000022 is in 2 parts, processing in Commerce. " +
        "Northwind ERP order 0000001000: created there. " +
        "Contoso ERP: its part waits (held).",
    );
  });

  test("Then a part whose ERP did not answer is not said to be missing", () => {
    expect(
      traceHeadline(
        {
          erps: [
            { name: "Northwind ERP", number: "1", part: "sent", status: null },
            {
              name: "Contoso ERP",
              number: "2",
              part: "sent",
              status: "shipped",
            },
          ],
          incrementId: "42",
          reachedErp: true,
        },
        "Northwind ERP",
      ),
    ).toBe(
      "Order 42 is in 2 parts. " +
        "Northwind ERP order 1: Northwind ERP did not answer for it. " +
        "Contoso ERP order 2: shipped there.",
    );
  });
});

describe("Given the trace's summary line", () => {
  test("Then it is Commerce's status, then each ERP's part", () => {
    expect(
      traceSummary({
        commerceStatus: "pending",
        erps: [
          {
            name: "Northwind ERP",
            number: "0000001013",
            part: "sent",
            status: "confirmed",
          },
          { name: "Contoso ERP", number: null, part: "held", status: null },
          { name: "Third ERP", number: null, part: "failed", status: null },
        ],
        incrementId: "3000000023",
      }),
    ).toStrictEqual([
      { label: "In Commerce", value: "Pending" },
      { label: "Northwind ERP", value: "0000001013 · confirmed" },
      { label: "Contoso ERP", value: "Waiting" },
      { label: "Third ERP", value: "Not taken" },
    ]);
  });

  test("Then with one ERP it is Commerce beside that ERP", () => {
    expect(
      traceSummary(
        {
          commerceStatus: "canceled",
          erpNumber: "0000001012",
          erpStatus: "cancelled",
          incrementId: "3000000022",
          reachedErp: true,
        },
        "Northwind ERP",
      ),
    ).toStrictEqual([
      { label: "In Commerce", value: "Canceled" },
      { label: "Northwind ERP", value: "0000001012 · canceled" },
    ]);
    expect(
      traceSummary({ incrementId: "1", reachedErp: false }, "Northwind ERP"),
    ).toStrictEqual([
      { label: "In Commerce", value: "–" },
      { label: "Northwind ERP", value: "Not reached" },
    ]);
  });
});
