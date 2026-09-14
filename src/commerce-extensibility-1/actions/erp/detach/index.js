import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import * as commerce from "#lib/commerce";
import { detach } from "#lib/detach";
import { erp } from "#lib/erp";
import * as ledger from "#lib/ledger";

/**
 * POST detach: undo what this integration wrote onto Commerce (company credit limits and
 * blocks, ERP numbers on orders) without touching the ERP. Demo Builder runs it before
 * removing the integration; reset runs the same code before wiping the ERP.
 */
async function main(params) {
  const logger = AioLogger("erp-detach", { level: params.LOG_LEVEL || "info" });
  try {
    const result = await detach(params, { commerce, erp, ledger });
    logger.info(
      `detach: reverted ${result.reverted.reverted} company write(s), cleared ${result.orders.cleared} order number(s)`,
    );
    return ok({ body: result });
  } catch (error) {
    logger.error(`detach failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
