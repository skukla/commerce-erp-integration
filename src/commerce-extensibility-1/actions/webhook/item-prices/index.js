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
} from "#lib/webhook";

// Commerce's soft_timeout (1 s) only logs; its hard timeout (10 s, app.commerce.config.ts)
// aborts, and this action's own Runtime limit is 15 s. Six seconds lets a cold ERP action
// answer; a slower one falls back to Commerce's own prices.
const ERP_TIMEOUT_MS = 6000;

const QUOTE_DEPS = {
  erp,
  erpCustomerOf,
  loadErps,
  readers: { productAttributes, sourceCodesOf },
};

/**
 * Totals collector, item prices: each cart line's price becomes the ERP's contract price
 * for the buyer's business partner. Lines the ERP does not know keep their price.
 */
async function main(params) {
  const logger = AioLogger("webhook-item-prices", {
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
    if (!settings.pricing_contract_prices) {
      logger.info(
        "pricing_contract_prices is off for this store; Commerce keeps its prices",
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
    const priceUpdates = [];
    const partners = [];
    for (const { res, lines: asked } of quoted) {
      if (!res.ok) {
        logger.warn(
          `ERP quote answered ${res.status}; Commerce keeps its prices`,
        );
        continue;
      }
      partners.push(res.data.partnerId);
      const bySku = knownBySku(res);
      priceUpdates.push(
        ...asked
          .filter((l) => bySku.has(l.sku))
          .map((l) => ({
            base_price: bySku.get(l.sku).contractPrice,
            item_id: l.itemId,
          }))
          .filter((u) => Number.isFinite(u.base_price) && u.base_price >= 0),
      );
    }
    if (priceUpdates.length === 0) {
      logger.info(
        `no contract price for partner ${partners.join(", ")} on ${lines.map((l) => l.sku).join(", ")} (cart buyer: ${JSON.stringify(cartBuyer(payload.quote))})`,
      );
      return noop();
    }
    logger.info(
      `item-prices: partner ${partners.join(", ")}, ${priceUpdates.length} line(s) priced`,
    );
    return operations([
      { op: "replace", path: "result/price_updates", value: priceUpdates },
    ]);
  } catch (error) {
    logger.error(
      `item-prices failed, Commerce keeps its prices: ${error.message}`,
    );
    return noop();
  }
}

export { main };
