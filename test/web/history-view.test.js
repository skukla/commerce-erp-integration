/*
 * What the Admin page's Activity says about each record (lib/history.js): the direction, the
 * ERPs it concerns, its type, one sentence, how it ended, whether Retry is offered and what a
 * click on it opens. The same rows fill Needs attention on the Overview.
 */
import {
  canRetry,
  dayGroups,
  eventRow,
  isProblem,
  needsAttention,
  RESULT,
  rowMatches,
  TYPES,
} from "#web/history-view.js";

const NOW = new Date("2026-09-28T15:00:00Z");
const ERPS = [
  { id: "erp", name: "Northwind ERP" },
  { id: "contoso", name: "Contoso ERP" },
];
const HELD_DETAIL =
  /^Order sent to Northwind ERP as NORT-0000001014 · Contoso ERP is in maintenance until 15:55/u;

const order = (outcome, extra = {}) => ({
  attempts: 1,
  direction: "to-erp",
  firstAt: "2026-09-28T10:00:00.000Z",
  kind: "order",
  lastAt: "2026-09-28T10:08:00.000Z",
  message: "order 3000000022 is ERP sales order 0000001012.",
  outcome,
  ref: "3000000022",
  ...extra,
});
const fromErp = (kind, ref, message, extra = {}) => ({
  attempts: 1,
  direction: "from-erp",
  eventId: "ev-1",
  kind,
  lastAt: "2026-09-28T14:30:00.000Z",
  message,
  outcome: "applied",
  ref,
  ...extra,
});

describe("Given how a record ended", () => {
  test("Then the words are plain", () => {
    expect(RESULT).toStrictEqual({
      applied: "Applied",
      done: "Done",
      dropped: "Not sent",
      failed: "Not applied yet",
      held: "Waiting for the ERP",
      refused: "Refused by Commerce",
      sending: "Sending",
      sent: "Sent",
    });
  });

  // Held orders are retried by I/O Events for a day; a person need not wait for that.
  test("Then Retry is offered for what did not get through, and only then", () => {
    expect(canRetry(order("held"))).toBe(true);
    expect(canRetry(order("dropped"))).toBe(true);
    expect(canRetry(order("sent"))).toBe(false);
  });

  // D8: a send still "sending" minutes later was cut off; one in flight is left alone.
  test("Then a send stuck on Sending is a problem, and one in flight is not", () => {
    const at = Date.parse("2026-09-28T10:08:00.000Z");
    expect(canRetry(order("sending"), at + 30_000)).toBe(false);
    expect(isProblem(order("sending"), at + 30_000)).toBe(false);
    expect(canRetry(order("sending"), at + 5 * 60_000)).toBe(true);
    expect(isProblem(order("sending"), at + 5 * 60_000)).toBe(true);
  });
});

describe("Given an order sent to the ERPs", () => {
  test("Then its row reads as one sentence, names its ERPs and opens its trace", () => {
    const row = eventRow(order("sent", { erpIds: ["erp"] }), {
      erps: ERPS,
      now: NOW,
    });
    expect(row).toMatchObject({
      direction: "to",
      directionLabel: "To ERP",
      erpIds: ["erp"],
      key: "order.3000000022",
      open: { kind: "trace", ref: "3000000022" },
      problem: false,
      result: "Sent",
      retriable: false,
      sentence: "Order 3000000022 is ERP sales order 0000001012",
      tone: "ok",
      type: "orders",
      typeLabel: "Order",
      unnamed: false,
    });
  });

  test("Then one that waits says why and how often it was tried, and Retry sends the order again", () => {
    const row = eventRow(
      order("held", {
        attempts: 3,
        erpIds: ["erp", "contoso"],
        message:
          "Order sent to Northwind ERP as 0000001014. Contoso ERP is in maintenance until 15:55 UTC.",
      }),
      { erps: ERPS, now: NOW },
    );
    expect(row).toMatchObject({
      detail:
        "Order sent to Northwind ERP as 0000001014 · Contoso ERP is in maintenance until 15:55 UTC · Sent again by itself for up to a day · 3 tries",
      problem: true,
      result: "Waiting for the ERP",
      retriable: true,
      retry: { incrementId: "3000000022" },
      sentence: "Order 3000000022: Contoso ERP’s part is waiting",
      tone: "warn",
    });
  });

  test("Then a split order that waits names the ERP whose part waits", () => {
    const row = eventRow(
      order("held", {
        erpIds: ["erp", "contoso"],
        message:
          "Order sent to Northwind ERP as NORT-0000001014. Contoso ERP is in maintenance until 15:55.",
        ref: "3000000024",
      }),
      { erps: ERPS, now: NOW },
    );
    expect(row.sentence).toBe(
      "Order 3000000024: Contoso ERP’s part is waiting",
    );
    expect(row.detail).toMatch(HELD_DETAIL);
  });

  test.each([
    [
      "order 3000000025 was refused by the ERP: accesspoint quantity 0 is not allowed",
      ["erp"],
      "Order 3000000025 was refused by Northwind ERP",
      "accesspoint quantity 0 is not allowed",
    ],
    [
      "order 42 is waiting for the ERP (the ERP answered 503).",
      [],
      "Order 42 is waiting for the ERP",
      "The ERP answered 503",
    ],
  ])(
    "Then an order that did not get through says why on its second line (%s)",
    (message, erpIds, sentence, detail) => {
      const row = eventRow(
        order("dropped", { erpIds, message, ref: sentence.split(" ")[1] }),
        { erps: ERPS, now: NOW },
      );
      expect(row.sentence).toBe(sentence);
      expect(row.detail).toBe(detail);
    },
  );

  test("Then an admin's retry is named", () => {
    const row = eventRow(order("sent", { attempts: 2, retriedBy: "admin" }), {
      erps: ERPS,
      now: NOW,
    });
    expect(row.detail).toBe("2 tries, the last by an admin");
  });
});

describe("Given an update from an ERP", () => {
  test.each([
    [
      "price",
      "accesspoint",
      "SKU accesspoint: price 189",
      "accesspoint: price 189",
      "prices",
      "Price",
      { kind: "product", sku: "accesspoint" },
    ],
    [
      "stock",
      "proliantdl380",
      "SKU proliantdl380 at contoso_warehouse: 42 in stock",
      "proliantdl380 at contoso_warehouse: 42 in stock",
      "stock",
      "Stock",
      { kind: "product", sku: "proliantdl380" },
    ],
    [
      "invoice",
      "3000000023",
      "order 3000000023: invoiced",
      "Order 3000000023: invoiced",
      "orders",
      "Invoice",
      { kind: "trace", ref: "3000000023" },
    ],
    [
      "hold",
      "3000000019",
      "order 3000000019: on credit hold",
      "Order 3000000019: on credit hold",
      "orders",
      "Credit hold",
      { kind: "trace", ref: "3000000019" },
    ],
    [
      "credit-memo",
      "5000000002",
      "order 5000000002: credited (credit memo 9500000001)",
      "Order 5000000002: credited (credit memo 9500000001)",
      "orders",
      "Credit memo",
      { kind: "trace", ref: "5000000002" },
    ],
    [
      "payment",
      "5000000002",
      "order 5000000002: paid (payment 7000000001, 42.5)",
      "Order 5000000002: paid (payment 7000000001, 42.5)",
      "orders",
      "Payment",
      { kind: "trace", ref: "5000000002" },
    ],
    [
      "return",
      "5000000002",
      "order 5000000002: return order 8000000001 received",
      "Order 5000000002: return order 8000000001 received",
      "orders",
      "Return received",
      { kind: "trace", ref: "5000000002" },
    ],
    [
      "stock",
      "",
      "SKU CAB at east: 4 in stock",
      "CAB at east: 4 in stock",
      "stock",
      "Stock",
      { kind: "record" },
    ],
  ])(
    "Then a %s update reads as what changed and opens what it is about",
    (kind, ref, message, sentence, type, typeLabel, open) => {
      const row = eventRow(fromErp(kind, ref, message, { erpIds: ["erp"] }), {
        erps: ERPS,
        now: NOW,
      });
      expect(row).toMatchObject({
        direction: "from",
        directionLabel: "From ERP",
        open,
        result: "Applied",
        sentence,
        type,
        typeLabel,
      });
    },
  );

  test("Then a company update names the company by its Commerce name, and opens it", () => {
    const row = eventRow(
      fromErp("credit", "100051", "customer 100051: credit limit 25000", {
        company: { id: "2", name: "ServerSavvy Solutions" },
        erpIds: ["erp"],
      }),
      { erps: ERPS, now: NOW },
    );
    expect(row).toMatchObject({
      open: { id: "2", kind: "company" },
      sentence: "ServerSavvy Solutions: credit limit 25000",
      type: "companies",
      typeLabel: "Credit",
    });
  });

  test("Then customer prices no company is linked to say the customer, and open the record", () => {
    const row = eventRow(
      fromErp(
        "contract",
        "100077",
        "partner 100077: 1 price line(s) in force — not applied: no Commerce company is paired with partner 100077",
        { erpIds: ["erp"], outcome: "refused" },
      ),
      { erps: ERPS, now: NOW },
    );
    expect(row).toMatchObject({
      detail: "Not applied: no Commerce company is paired with partner 100077",
      open: { kind: "record" },
      problem: true,
      result: "Refused by Commerce",
      retriable: true,
      retry: { eventId: "ev-1" },
      sentence: "Northwind customer 100077: 1 customer price in force",
      tone: "bad",
      typeLabel: "Customer prices",
    });
  });

  test("Then a company's customer prices read as a count of prices, by its name", () => {
    const row = eventRow(
      fromErp(
        "contract",
        "100042",
        "partner 100042: 3 price line(s) in force",
        {
          company: { id: "4", name: "Kukla Studios" },
          erpIds: ["erp"],
        },
      ),
      { erps: ERPS, now: NOW },
    );
    expect(row.sentence).toBe("Kukla Studios: 3 customer prices in force");
  });

  test("Then an update not applied yet is sent again by itself, and says so", () => {
    const row = eventRow(
      fromErp(
        "price",
        "accesspoint",
        "SKU accesspoint: price 189 — not applied: Commerce did not answer",
        { attempts: 2, outcome: "failed" },
      ),
      { erps: ERPS, now: NOW },
    );
    expect(row.detail).toBe(
      "Not applied: Commerce did not answer · Sent again by itself for up to a day · 2 tries",
    );
    expect(row.unnamed).toBe(true);
  });
});

describe("Given a change made in Commerce Admin", () => {
  test("Then it names the ERPs it went to and opens its order's trace", () => {
    const row = eventRow(
      {
        attempts: 1,
        direction: "to-erp",
        erpIds: ["erp"],
        kind: "shipped",
        lastAt: "2026-09-28T11:02:00Z",
        message:
          "Commerce shipment 3000000011: told Northwind ERP about its lines.",
        orderRef: "3000000021",
        outcome: "sent",
        ref: "3000000011",
      },
      { erps: ERPS, now: NOW },
    );
    expect(row).toMatchObject({
      detail: "Shipped in Commerce Admin",
      erpIds: ["erp"],
      open: { kind: "trace", ref: "3000000021" },
      retriable: false,
      sentence:
        "Commerce shipment 3000000011: told Northwind ERP about its lines",
      typeLabel: "Shipment",
    });
  });

  test("Then a return made in Commerce names the ERPs it went to and opens its order's trace", () => {
    const row = eventRow(
      {
        attempts: 1,
        direction: "to-erp",
        erpIds: ["erp"],
        kind: "returned",
        lastAt: "2026-10-02T11:02:00Z",
        message:
          "return 000000004: sent to Northwind ERP as return order 8000000001.",
        orderRef: "5000000002",
        outcome: "sent",
        ref: "000000004",
      },
      { erps: ERPS, now: NOW },
    );
    expect(row).toMatchObject({
      detail: "Return made in Commerce",
      open: { kind: "trace", ref: "5000000002" },
      type: "orders",
      typeLabel: "Return",
    });
  });

  test("Then one recorded before changes named their ERPs says so, and opens nothing it cannot", () => {
    const row = eventRow(
      {
        attempts: 1,
        direction: "to-erp",
        kind: "invoiced",
        lastAt: "2026-09-28T11:05:00Z",
        message: "Commerce invoice 7: told no ERP about its lines.",
        outcome: "held",
        ref: "7",
      },
      { erps: ERPS, now: NOW },
    );
    // A change is delivered again by I/O Events; the order is not sent again by hand.
    expect(row).toMatchObject({
      open: { kind: "record" },
      retriable: false,
      unnamed: true,
    });
  });
});

describe("Given a demo reset's line", () => {
  test("Then it reads as one plain line for every ERP, with nothing to retry", () => {
    const message =
      "Demo reset on 2026-09-27: no orders to close; the ERPs' changes in Commerce undone. The activity before it was cleared.";
    const row = eventRow(
      {
        attempts: 1,
        direction: "reset",
        erpIds: ["erp", "contoso"],
        kind: "reset",
        lastAt: "2026-09-27T17:40:00.000Z",
        message,
        outcome: "done",
        ref: "2026-09-27",
      },
      { erps: ERPS, now: NOW },
    );
    expect(row).toMatchObject({
      direction: "reset",
      directionLabel: "Demo Builder",
      everyErp: true,
      open: { kind: "reset" },
      result: "Done",
      retriable: false,
      sentence: message,
      tone: "neutral",
      type: "reset",
    });
  });
});

describe("Given a product deleted in Commerce", () => {
  // AB-26y step 5: the delete is recorded and told to no ERP, so the row does not read
  // "To ERP"; a click opens the product's look-up, which shows whether an ERP still holds it.
  test("Then the row reads as made in Commerce, done, and opens the product", () => {
    const row = eventRow(
      {
        attempts: 1,
        direction: "commerce",
        erpIds: ["contoso"],
        kind: "product-deleted",
        lastAt: "2026-09-28T10:08:00.000Z",
        message:
          "Product SIGN1 was deleted in Commerce. Contoso ERP keeps it until its next reset",
        outcome: "done",
        ref: "SIGN1",
      },
      { erps: ERPS, now: NOW },
    );
    expect(row).toMatchObject({
      detail: "Contoso ERP keeps it until its next reset",
      direction: "commerce",
      directionLabel: "In Commerce",
      erpIds: ["contoso"],
      key: "product-deleted.SIGN1",
      open: { kind: "product", sku: "SIGN1" },
      problem: false,
      result: "Done",
      retriable: false,
      sentence: "Product SIGN1 was deleted in Commerce",
      tone: "neutral",
      type: "products",
      typeLabel: "Product deleted",
    });
  });
});

describe("Given one ERP", () => {
  test("Then every row is that ERP's", () => {
    const row = eventRow(order("sent"), { erps: [ERPS[0]], now: NOW });
    expect(row).toMatchObject({ erpIds: ["erp"], unnamed: false });
  });
});

describe("Given the feed's filters and days", () => {
  const rows = [
    eventRow(order("held", { erpIds: ["contoso"] }), { erps: ERPS, now: NOW }),
    eventRow(
      fromErp("price", "A", "SKU A: price 1", {
        erpIds: ["erp"],
        lastAt: "2026-09-27T18:00:00Z",
      }),
      { erps: ERPS, now: NOW },
    ),
  ];

  test("Then the types are the filter's, in order", () => {
    expect(TYPES.map((t) => t.label)).toStrictEqual([
      "Orders",
      "Prices",
      "Stock",
      "Companies",
      "Demo reset",
    ]);
  });

  test("Then a row shows only when it matches every filter", () => {
    const all = { erp: "", problems: false, type: "" };
    expect(rows.filter((r) => rowMatches(r, all))).toHaveLength(2);
    expect(
      rows.filter((r) => rowMatches(r, { ...all, erp: "erp" })),
    ).toStrictEqual([rows[1]]);
    expect(
      rows.filter((r) => rowMatches(r, { ...all, type: "orders" })),
    ).toStrictEqual([rows[0]]);
    expect(
      rows.filter((r) => rowMatches(r, { ...all, problems: true })),
    ).toStrictEqual([rows[0]]);
  });

  test("Then the rows are grouped by day, newest first", () => {
    expect(
      dayGroups(rows, NOW, "UTC").map((g) => [g.title, g.rows.length]),
    ).toStrictEqual([
      ["Today", 1],
      ["Yesterday", 1],
    ]);
  });

  test("Then Needs attention is every record that did not get through", () => {
    const entries = [
      order("sent"),
      order("held", { ref: "3000000024" }),
      fromErp("price", "A", "SKU A: price 1", { outcome: "refused" }),
    ];
    expect(
      needsAttention(entries, { erps: ERPS, now: NOW }).map((r) => r.key),
    ).toStrictEqual(["order.3000000024", "erp.ev-1"]);
  });
});
