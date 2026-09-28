import AioLogger from "@adobe/aio-lib-core-logging";

import { knownBySku, quoteCart } from "#lib/cart-quotes";
import { productAttributes, sourceCodesOf } from "#lib/commerce";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { erpCustomerOf } from "#lib/key-map";
import { settingsFor } from "#lib/settings";
import {
  cartBuyer,
  cartLines,
  noop,
  operations,
  readPayload,
  round2,
} from "#lib/webhook";

// Commerce's soft_timeout (1 s) only logs; its hard timeout (10 s, app.commerce.config.ts)
// aborts, and this action's own Runtime limit is 15 s. Six seconds lets a cold ERP action
// answer; a slower one falls back to Commerce's own totals.
const ERP_TIMEOUT_MS = 6000;

const QUOTE_DEPS = {
  erp,
  erpCustomerOf,
  loadErps,
  readers: { productAttributes, sourceCodesOf },
};

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
    logger.info(`cart buyer: ${JSON.stringify(cartBuyer(payload.quote))}`);
    const lines = cartLines(payload);
    if (lines.length === 0) {
      logger.info(
        `no cart lines in the payload (keys: ${Object.keys(payload).join(", ") || "none"}; quote keys: ${Object.keys(payload.quote ?? {}).join(", ") || "none"})`,
      );
      return noop();
    }
    const settings = await settingsFor(payload.quote?.store_id, logger);
    if (!settings.pricing_discount_ceiling) {
      logger.info(
        "pricing_discount_ceiling is off for this store; Commerce keeps its totals",
      );
      return noop();
    }
    const quoted = await quoteCart(
      params,
      payload.quote,
      lines,
      QUOTE_DEPS,
      ERP_TIMEOUT_MS,
    );
    let clawback = 0;
    const itemIds = [];
    const partners = [];
    for (const { res, lines: asked } of quoted) {
      if (!res.ok) {
        logger.warn(
          `ERP quote answered ${res.status}; Commerce keeps its totals`,
        );
        continue;
      }
      partners.push(res.data.partnerId);
      const bySku = knownBySku(res);
      for (const line of asked) {
        const quotedLine = bySku.get(line.sku);
        if (!quotedLine) {
          continue;
        }
        const excess = excessOverCeiling(line, quotedLine);
        if (excess > 0) {
          clawback = round2(clawback + excess);
          itemIds.push(line.itemId);
        }
      }
    }
    if (clawback === 0) {
      logger.info(
        `no discount over the ceiling for partner ${partners.join(", ")} (cart buyer: ${JSON.stringify(cartBuyer(payload.quote))})`,
      );
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
