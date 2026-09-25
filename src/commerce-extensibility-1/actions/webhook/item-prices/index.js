import AioLogger from "@adobe/aio-lib-core-logging";

import { erp } from "#lib/erp";
import { settingsFor } from "#lib/settings";
import {
  cartLines,
  noop,
  operations,
  partnerHints,
  readPayload,
} from "#lib/webhook";

// Commerce's soft_timeout (1 s) only logs; its hard timeout (10 s, app.commerce.config.ts)
// aborts, and this action's own Runtime limit is 15 s. Six seconds lets a cold ERP action
// answer; a slower one falls back to Commerce's own prices.
const ERP_TIMEOUT_MS = 6000;

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
        `ERP quote answered ${res.status}; Commerce keeps its prices`,
      );
      return noop();
    }
    const bySku = new Map(
      (res.data.lines ?? []).filter((l) => !l.unknown).map((l) => [l.sku, l]),
    );
    const priceUpdates = lines
      .filter((l) => bySku.has(l.sku))
      .map((l) => ({
        base_price: bySku.get(l.sku).contractPrice,
        item_id: l.itemId,
      }))
      .filter((u) => Number.isFinite(u.base_price) && u.base_price >= 0);
    if (priceUpdates.length === 0) {
      logger.info(
        `no contract price for partner ${res.data.partnerId} on ${lines.map((l) => l.sku).join(", ")} (hints: ${JSON.stringify(partnerHints(payload.quote))})`,
      );
      return noop();
    }
    logger.info(
      `item-prices: partner ${res.data.partnerId}, ${priceUpdates.length} line(s) priced`,
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
