/*
 * The live checks at order placement (pricing-and-live-checks.md, owner 2026-09-28):
 * once per owning ERP, as the order is placed — credit ([[AB-20]]) and availability
 * ([[AB-19]]). Pure over its injected collaborators, so it is tested without Commerce or an
 * ERP.
 *
 * It REPORTS what each owning ERP said; it does not decide what a "no" does. The caller does:
 * the placement webhook blocks the order on a definitive credit denial (creditVerdict below);
 * availability never blocks — its promise date is recorded on the part and the shortfall ships
 * later.
 *
 * FAIL-OPEN is the rule that makes a live check safe: an ERP that is slow, down or errors is
 * reported `unavailable`, never thrown. A down ERP must not stop a buyer checking out — its
 * lines keep Commerce's price, the order goes through, and its part is Partially Held. Only a
 * definitive credit "no" (over the limit, or the account blocked) is a block.
 */

/** The ERP credit-check status that means "no": the account cannot carry this. */
const CREDIT_HELD = "held";
/** What a slow/down/erroring ERP is reported as — never a block. */
const UNAVAILABLE = "unavailable";

/** A cart/order line's ordered quantity, whichever field the payload carries. */
function qtyOf(line) {
  return Number(line.qty_ordered ?? line.qty) || 0;
}

/** A line's unit price, whichever field the payload carries. */
function priceOf(line) {
  return Number(line.base_price ?? line.price) || 0;
}

/**
 * The net of one ERP's part: the sum of its lines, to cents. A configurable's child line
 * travels with its parent and carries no money of its own — the parent line is the row —
 * so children are left out, or the part would be counted twice.
 */
export function partNet(lines) {
  const sum = lines
    .filter((line) => !line.parent_item_id)
    .reduce((total, line) => total + qtyOf(line) * priceOf(line), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Ask each owning ERP, once, whether the company can carry its part (credit) and by when it can
 * promise the quantity (availability).
 *
 * @param {object} order the order/quote being placed
 * @param {object} deps injected collaborators:
 *   - `splitByErp(order)` → `Promise<Iterable<{ erp: {id,name}, lines: object[] }>>`
 *   - `companyIdOf(order)` → `Promise<string|null>` the buyer's Commerce company (null for a guest)
 *   - `erpCustomerOf(companyId, erpId)` → `Promise<string|null>` that ERP's partner number
 *   - `creditCheck(erp, partnerId, net, currency)` → `Promise<{status, reason}>` (may throw)
 *   - `availability(erp, lines)` → `Promise<object[]>` per-line promises for the part's raw
 *     lines (lib/erp-availability.js picks the lines to ask about; may throw)
 *   - `currency` the order currency (default USD); `logger` optional
 * @returns {Promise<{ companyId: string|null, results: Array<{ erpId, erpName, credit, promises }>}>}
 *   `credit` is `{status, reason, net}` with status `approved|held|unavailable|null` (null: no
 *   company, so no ERP credit relationship). `promises` is the availability answer, or null when
 *   the ERP could not be reached.
 */
export async function assessPlacement(order, deps) {
  const {
    splitByErp,
    companyIdOf,
    erpCustomerOf,
    creditCheck,
    availability,
    currency = "USD",
    logger,
  } = deps;
  const companyId = await companyIdOf(order);
  const parts = [...(await splitByErp(order))];
  const results = [];
  for (const { erp, lines } of parts) {
    const net = partNet(lines);
    // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, few ERPs
    const partnerId = companyId ? await erpCustomerOf(companyId, erp.id) : null;
    // Credit and availability together, so one ERP costs one round trip, not two: the caller
    // runs inside Commerce's hard timeout and every second is the shopper's.
    const askCredit = async () => {
      if (!partnerId) {
        return { status: null, reason: null, net };
      }
      try {
        const answer = await creditCheck(erp, partnerId, net, currency);
        return { status: answer.status, reason: answer.reason ?? null, net };
      } catch (error) {
        logger?.warn?.(`${erp.name} credit check unavailable: ${error.message}`);
        return { status: UNAVAILABLE, reason: error.message, net };
      }
    };
    const askAvailability = async () => {
      try {
        return await availability(erp, lines);
      } catch (error) {
        logger?.warn?.(`${erp.name} availability unavailable: ${error.message}`);
        return null;
      }
    };
    // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time
    const [credit, promises] = await Promise.all([askCredit(), askAvailability()]);
    results.push({ erpId: erp.id, erpName: erp.name, credit, promises });
  }
  return { companyId, results };
}

/**
 * The placement webhook's verdict for CREDIT: block only on a definitive denial from an owning
 * ERP. An unavailable ERP (slow, down, erroring) does NOT block — that is the fail-open rule.
 * With several ERPs, any one owning ERP's denial blocks the whole placement, because a
 * synchronous checkout cannot place part of an order.
 *
 * @param {{ results: Array<{ erpName, credit: {status, reason} }> }} assessment
 * @returns {{ block: boolean, reason?: string }}
 */
export function creditVerdict(assessment) {
  const denied = assessment.results.filter(
    (result) => result.credit.status === CREDIT_HELD,
  );
  if (denied.length === 0) {
    return { block: false };
  }
  return {
    block: true,
    reason: denied.map((r) => r.credit.reason || `${r.erpName} declined`).join("; "),
  };
}
