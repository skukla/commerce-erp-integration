/*
 * The cart checks' question to the ERPs (design v1 §3.2). With one ERP it is today's single
 * quote for every line. With several, each line goes to the ERP that owns its product (the
 * router's ownership rule, src/router/ownership.js) and each owning ERP is asked, at its own
 * address and as its own customer for the cart's company, for its own lines only. The ERPs are
 * asked at the same time. An ERP that fails or times out answers "not ok" for its lines, which
 * keep Commerce's price: a cart is never failed by one ERP. A line no ERP owns, or two claim,
 * is asked of nobody.
 */
import { paramsForErp } from "#adapters/contract";
import { ownsSku as structureOwnsSku } from "#lib/structure";
import { erpBuyer } from "#lib/webhook";
import { ownersOf } from "#router/ownership";

/** Read each SKU once per cart, however many ERPs ask about it. */
function memoised(read) {
  const seen = new Map();
  return (params, sku) => {
    if (!seen.has(sku)) {
      seen.set(sku, read(params, sku));
    }
    return seen.get(sku);
  };
}

function askedOf(lines) {
  return lines.map((l) => ({ qty: l.qty, sku: l.sku }));
}

async function ask(deps, params, body, timeoutMs) {
  try {
    return await deps.erp.quote(params, body, timeoutMs);
  } catch (error) {
    return { data: { errorMessage: error.message }, ok: false, status: 0 };
  }
}

/** Group the cart's lines by their one owning ERP. */
async function linesByOwner(params, lines, erps, readers) {
  const productAttributes = memoised(readers.productAttributes);
  const sourceCodesOf = memoised(readers.sourceCodesOf);
  const ownsSku = (p, sku, settings) =>
    structureOwnsSku(p, sku, settings, { productAttributes, sourceCodesOf });
  const owners = await Promise.all(
    lines.map((l) => ownersOf(params, l.sku, erps, ownsSku).catch(() => [])),
  );
  const byErp = new Map();
  for (const [index, line] of lines.entries()) {
    if (owners[index].length === 1) {
      const [id] = owners[index];
      byErp.set(id, [...(byErp.get(id) ?? []), line]);
    }
  }
  return byErp;
}

/**
 * @param {object} params action params
 * @param {object} quote the payload's quote (the buyer)
 * @param {object[]} lines the cart lines (lib/webhook.js cartLines)
 * @param {object} deps `{ erp, erpCustomerOf, loadErps, readers }`
 * @param {number} timeoutMs each ERP's time limit
 * @returns {Promise<Array<{ erp: object, lines: object[], res: object }>>} one answer per
 *   ERP asked
 */
export async function quoteCart(params, quote, lines, deps, timeoutMs) {
  const erps = await deps.loadErps(params);
  if (erps.length === 1) {
    const res = await deps.erp.quote(
      params,
      {
        ...(await erpBuyer(quote, deps.erpCustomerOf)),
        lines: askedOf(lines),
      },
      timeoutMs,
    );
    return [{ erp: erps[0], lines, res }];
  }
  const byErp = await linesByOwner(params, lines, erps, deps.readers);
  return Promise.all(
    erps
      .filter((entry) => byErp.has(entry.id))
      .map(async (entry) => {
        const own = byErp.get(entry.id);
        const buyer = await erpBuyer(quote, (company) =>
          deps.erpCustomerOf(company, entry.id),
        );
        const res = await ask(
          deps,
          paramsForErp(params, entry),
          { ...buyer, lines: askedOf(own) },
          timeoutMs,
        );
        return { erp: entry, lines: own, res };
      }),
  );
}

/** The quoted lines an ERP knows, by SKU. */
export function knownBySku(res) {
  return new Map(
    (res.data?.lines ?? []).filter((l) => !l.unknown).map((l) => [l.sku, l]),
  );
}
