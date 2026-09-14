import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import appConfig from "#app.commerce.config";
import { erp } from "#lib/erp";
import { readLedger } from "#lib/ledger";

/**
 * GET status: the ERP's health as the integration sees it, the ledger size, and what
 * this app declares. The flyout's status tool and the Admin screen read this.
 */
async function main(params) {
  const logger = AioLogger("erp-status", { level: params.LOG_LEVEL || "info" });
  try {
    let health = { ok: false, reachable: false };
    try {
      const res = await erp.health(params);
      health = {
        reachable: true,
        status: res.status,
        ...(res.ok ? res.data : { error: res.data?.errorMessage, ok: false }),
      };
    } catch (error) {
      health = { error: error.message, ok: false, reachable: false };
    }
    const ledger = await readLedger();
    return ok({
      body: {
        app: { id: appConfig.metadata.id, version: appConfig.metadata.version },
        erp: health,
        erpBaseUrl: params.ERP_BASE_URL || null,
        ledger: { entries: ledger.length },
      },
    });
  } catch (error) {
    logger.error(`status failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
