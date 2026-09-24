import AioLogger from "@adobe/aio-lib-core-logging";

import * as commerce from "#lib/commerce";
import { erp } from "#lib/erp";
import { mirrorPartners } from "#lib/mirror";
import { websiteSettings } from "#lib/settings";
import { refreshStock } from "#lib/stock-refresh";
import * as snapshot from "#lib/stock-snapshot";

/**
 * What the every-minute timer runs: the partners (Commerce raises no event for
 * companies) and the stock per source (Commerce raises no event for a source item; its
 * legacy stock event covers the default source only). Not a web action: a timer carries
 * no Adobe sign-in, and the web action `refresh-partners` requires one, so every timer
 * run of it failed in the sign-in check before its code started (measured 2026-09-16).
 *
 * Each half reports its own failure and the other still runs.
 */
async function main(params) {
  const logger = AioLogger("erp-refresh-job", {
    level: params.LOG_LEVEL || "info",
  });
  const out = { ok: true };
  try {
    const partners = await mirrorPartners(
      params,
      { ...commerce, websiteSettings: (code) => websiteSettings(code, logger) },
      erp,
    );
    logger.info(`refreshed ${partners.companies} companies into the ERP`);
    out.partners = partners;
  } catch (error) {
    logger.error(`partner refresh failed: ${error.message}`);
    out.ok = false;
    out.partnersError = error.message;
  }
  try {
    const stock = await refreshStock(params, commerce, erp, snapshot);
    logger.info(
      stock.seeded
        ? "stock snapshot seeded"
        : `stock: ${stock.changed.length} SKU(s) changed, ${stock.sent} sent to the ERP`,
    );
    out.stock = stock;
  } catch (error) {
    logger.error(`stock refresh failed: ${error.message}`);
    out.ok = false;
    out.stockError = error.message;
  }
  return out;
}

export { main };
