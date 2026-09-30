/*
 * What the ERP promised for a part, in a sentence (AB-19): built from the promises the router
 * recorded on the part (lib/erp-availability.js answer shape), never from a call.
 */
import { promiseWords } from "#lib/order-parts-view";

test("no promises — the ERP was not asked or could not answer — is no sentence", () => {
  expect(promiseWords(undefined)).toBeNull();
  expect(promiseWords(null)).toBeNull();
  expect(promiseWords([])).toBeNull();
});

test("every line available now", () => {
  expect(
    promiseWords([
      { canPromiseNow: true, sku: "A1" },
      { canPromiseNow: true, sku: "B1" },
    ]),
  ).toBe("2 of 2 lines ship now");
});

test("a shortfall names the line and the date the ERP promises", () => {
  expect(
    promiseWords([
      { canPromiseNow: true, sku: "A1" },
      { canPromiseNow: false, promiseDate: "2026-10-07", sku: "B1" },
      { canPromiseNow: false, promiseDate: "2026-10-12", sku: "C1" },
    ]),
  ).toBe("1 of 3 lines ship now; B1 by 2026-10-07, C1 by 2026-10-12");
});

test("one line reads in the singular", () => {
  expect(promiseWords([{ canPromiseNow: true, sku: "A1" }])).toBe(
    "1 of 1 line ships now",
  );
});

test("a SKU the ERP does not have is counted apart, not as a shortfall", () => {
  expect(
    promiseWords([
      { canPromiseNow: true, sku: "A1" },
      { sku: "GHOST", unknown: true },
    ]),
  ).toBe("1 of 1 line ships now; 1 line the ERP does not have");
});
