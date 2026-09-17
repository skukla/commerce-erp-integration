import AioLogger from "@adobe/aio-lib-core-logging";

import { erp } from "#lib/erp";
import { settingsFor } from "#lib/settings";
import {
  cartLines,
  noop,
  operations,
  partnerHints,
  readPayload,
  round2,
} from "#lib/webhook";

// Commerce's soft_timeout (1 s) only logs; its hard timeout (5 s, app.commerce.config.ts) aborts.
// Three seconds lets a cold ERP action answer; a slower one falls back to Commerce's prices.
const ERP_TIMEOUT_MS = 3000;

/**
 * Totals collector, execute: hold each line at the ERP's maximum-discount ceiling. The
 * line already carries the contract price (item-prices ran first) plus whatever Commerce's
 * own rules took off. When that combined discount is deeper than the ceiling allows, the
 * excess is clawed back as a negative cart discount.
 *
 * @param {object} line a cart line with basePrice (the contract price) and nativeDiscount
 * @param {object} quoted the ERP's line: listPrice, maxDiscountPercent
 * @returns {number} the excess to claw back, 0 when the ceiling holds
 */
export function excessOverCeiling(line, quoted) {
  const list = Number(quoted.listPrice);
  if (!(list > 0)) {
    return 0;
  }
  const floor = round2(list * (1 - Number(quoted.maxDiscountPercent) / 100));
  const paidPerUnit =
    line.basePrice - line.nativeDiscount / Math.max(line.qty, 1);
  const excess = round2((floor - paidPerUnit) * line.qty);
  return excess > 0 ? excess : 0;
}

async function main(params) {
  const logger = AioLogger("webhook-discounts", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const payload = readPayload(params);
    const lines = cartLines(payload);
    if (lines.length === 0) {
      return noop();
    }
    const settings = await settingsFor(payload.quote?.store_id, logger);
    if (!settings.pricing_discount_ceiling) {
      return noop();
    }
    const res = await erp.quote(
      params,
      {
        ...partnerHints(payload.quote),
        lines: lines.map((l) => ({ qty: l.qty, sku: l.sku })),
      },
      ERP_TIMEOUT_MS,
    );
    if (!res.ok) {
      logger.warn(
        `ERP quote answered ${res.status}; Commerce keeps its totals`,
      );
      return noop();
    }
    const bySku = new Map(
      (res.data.lines ?? []).filter((l) => !l.unknown).map((l) => [l.sku, l]),
    );
    let clawback = 0;
    const itemIds = [];
    for (const line of lines) {
      const quoted = bySku.get(line.sku);
      if (!quoted) {
        continue;
      }
      const excess = excessOverCeiling(line, quoted);
      if (excess > 0) {
        clawback = round2(clawback + excess);
        itemIds.push(line.itemId);
      }
    }
    if (clawback === 0) {
      return noop();
    }
    logger.info(
      `discounts: ceiling clawback ${clawback} on ${itemIds.length} line(s)`,
    );
    return operations([
      {
        op: "replace",
        path: "result",
        value: {
          base_discount: -clawback,
          code: "erp_discount_ceiling",
          discount_description_array: ["ERP maximum discount"],
          discount_item_id_array: itemIds,
          discount_type: "fixed",
        },
      },
    ]);
  } catch (error) {
    logger.error(
      `discounts failed, Commerce keeps its totals: ${error.message}`,
    );
    return noop();
  }
}

export { main };
