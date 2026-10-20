/*
 * The live checks at placement (AB-19 availability, AB-20 credit): once per owning ERP, and
 * fail-open so a down ERP never blocks a checkout. assessPlacement reports each owning ERP's
 * answer; creditVerdict turns those answers into the webhook's block/allow, blocking only on a
 * definitive credit denial (pricing-and-live-checks.md).
 */
import { assessPlacement, creditVerdict, partNet } from "#lib/placement-checks";

const ACME = { id: "acme", name: "ACME ERP" };
const NW = { id: "nw", name: "Northwind ERP" };

/** An order line as the placement payload carries it. */
const line = (sku, qty, price, extra = {}) => ({
  base_price: price,
  item_id: `${sku}-i`,
  qty_ordered: qty,
  sku,
  ...extra,
});

/** Deps with sensible fakes; override per test. */
function deps(over = {}) {
  return {
    availability: async () => [{ canPromiseNow: true, sku: "A1" }],
    companyIdOf: async () => "7",
    creditCheck: async () => ({ reason: null, status: "approved" }),
    erpCustomerOf: async (_companyId, erpId) => `C-${erpId}`,
    splitByErp: async () => [{ erp: ACME, lines: [line("A1", 2, 100)] }],
    ...over,
  };
}

test("partNet sums an ERP part's lines to cents, ignoring child lines' own math", () => {
  expect(partNet([line("A1", 2, 100), line("B1", 3, 19.99)])).toBe(259.97);
});

test("a company order the ERP approves reports approved credit and the promise; no block", async () => {
  const a = await assessPlacement({}, deps());
  expect(a.results).toHaveLength(1);
  expect(a.results[0]).toMatchObject({
    credit: { net: 200, status: "approved" },
    erpId: "acme",
  });
  expect(a.results[0].promises).toEqual([{ canPromiseNow: true, sku: "A1" }]);
  expect(creditVerdict(a)).toEqual({ block: false });
});

test("an over-limit company order reports held credit and creditVerdict blocks with the reason", async () => {
  const a = await assessPlacement(
    {},
    deps({
      creditCheck: async () => ({
        reason: "Credit limit USD 1,000.00 exceeded by USD 100.00",
        status: "held",
      }),
    }),
  );
  expect(a.results[0].credit.status).toBe("held");
  expect(creditVerdict(a)).toEqual({
    block: true,
    reason: "Credit limit USD 1,000.00 exceeded by USD 100.00",
  });
});

test("a credit check that throws is reported unavailable and does NOT block (fail-open)", async () => {
  const warn = vi.fn();
  const a = await assessPlacement(
    {},
    deps({
      // A rejected promise, as an async stub that throws gives (useAwait).
      creditCheck: () => Promise.reject(new Error("ERP timed out")),
      logger: { warn },
    }),
  );
  expect(a.results[0].credit.status).toBe("unavailable");
  expect(creditVerdict(a)).toEqual({ block: false });
  expect(warn).toHaveBeenCalled();
});

test("availability that throws leaves a null promise and never blocks", async () => {
  const a = await assessPlacement(
    {},
    deps({
      availability: () => Promise.reject(new Error("ERP down")),
    }),
  );
  expect(a.results[0].promises).toBeNull();
  expect(creditVerdict(a)).toEqual({ block: false });
});

test("a guest (no company) is asked no credit; status is null and nothing blocks", async () => {
  const credit = vi.fn();
  const a = await assessPlacement(
    {},
    deps({ companyIdOf: async () => null, creditCheck: credit }),
  );
  expect(credit).not.toHaveBeenCalled();
  expect(a.results[0].credit.status).toBeNull();
  expect(creditVerdict(a)).toEqual({ block: false });
});

test("several ERPs: each is asked for its own part; any one denial blocks the whole placement", async () => {
  const a = await assessPlacement(
    {},
    deps({
      creditCheck: async (erp, _partner, net) =>
        erp.id === "nw"
          ? { reason: `${erp.name}: over limit`, status: "held" }
          : { _net: net, reason: null, status: "approved" },
      splitByErp: async () => [
        { erp: ACME, lines: [line("A1", 1, 100)] },
        { erp: NW, lines: [line("N1", 5, 40)] },
      ],
    }),
  );
  expect(a.results.map((r) => r.erpId)).toEqual(["acme", "nw"]);
  expect(a.results[1].credit.net).toBe(200);
  expect(creditVerdict(a)).toEqual({
    block: true,
    reason: "Northwind ERP: over limit",
  });
});

test("one ERP down among several does not block; only the real denial would", async () => {
  const a = await assessPlacement(
    {},
    deps({
      creditCheck: (erp) =>
        erp.id === "nw"
          ? Promise.reject(new Error("timeout"))
          : Promise.resolve({ reason: null, status: "approved" }),
      splitByErp: async () => [
        { erp: ACME, lines: [line("A1", 1, 100)] },
        { erp: NW, lines: [line("N1", 1, 40)] },
      ],
    }),
  );
  expect(a.results[1].credit.status).toBe("unavailable");
  expect(creditVerdict(a)).toEqual({ block: false });
});
