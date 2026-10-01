/*
 * The ownership check's Commerce readers for one invocation that asks about many SKUs: a
 * price publish (lib/contract-prices.js). Reading products/{sku} once per SKU per ERP took
 * 144 reads for two ERPs and 72 lines (measured 2026-10-01), past Runtime's 60 seconds. Here
 * the SKUs the caller says it will ask about are read together, in one search per hundred
 * SKUs, and each answer is kept for the rest of the invocation, so a second ERP reads nothing
 * again. The answers are the per-SKU readers' answers: the same rule decides ownership.
 */
import {
  productAttributes,
  productAttributesOfSkus,
  sourceCodesOf,
  sourceCodesOfSkus,
} from "#lib/commerce";

/** Commerce matches a SKU without regard to case, so its answer may differ in case. */
const keyOf = (sku) => String(sku).toLowerCase();

/**
 * A per-SKU reader that reads every expected SKU not yet asked in one batch, and remembers.
 * @param {(params: object, skus: string[]) => Promise<Map<string, *>>} readMany
 * @param {(params: object, sku: string) => Promise<*>} whenAbsent the answer for a SKU the
 *   batch did not carry
 * @param {Set<string>} expected the SKUs the caller will ask about
 */
function batchedReader(readMany, whenAbsent, expected) {
  const known = new Map();
  const asked = new Set();
  return async (params, sku) => {
    const key = keyOf(sku);
    if (!asked.has(key)) {
      const pending = [...new Set([...expected, sku])].filter(
        (s) => !asked.has(keyOf(s)),
      );
      const found = await readMany(params, pending);
      for (const s of pending) {
        asked.add(keyOf(s));
      }
      for (const [s, value] of found) {
        known.set(keyOf(s), value);
      }
    }
    if (!known.has(key)) {
      known.set(key, await whenAbsent(params, sku));
    }
    return known.get(key);
  };
}

/**
 * @returns {{ expect(skus: string[]): void,
 *   productAttributes(params: object, sku: string): Promise<object>,
 *   sourceCodesOf(params: object, sku: string): Promise<string[]> }} `expect` names SKUs
 *   the next reads should carry; the readers stand in for lib/commerce.js's per-SKU ones
 */
export function ownershipReaders() {
  const expected = new Set();
  return {
    expect: (skus) => {
      for (const sku of skus) {
        if (sku) {
          expected.add(String(sku));
        }
      }
    },
    // Absent from the search: read on its own, so a product Commerce lacks fails as before.
    productAttributes: batchedReader(
      productAttributesOfSkus,
      productAttributes,
      expected,
    ),
    // Absent from the search: no source, unless a comma kept it out of the search.
    sourceCodesOf: batchedReader(
      sourceCodesOfSkus,
      async (params, sku) =>
        String(sku).includes(",") ? sourceCodesOf(params, sku) : [],
      expected,
    ),
  };
}
