import AioLogger from "@adobe/aio-lib-core-logging";

import { erp } from "#lib/erp";
import {
  cartLines,
  noop,
  operations,
  partnerHints,
  readPayload,
} from "#lib/webhook";

const ERP_TIMEOUT_MS = 900;

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
