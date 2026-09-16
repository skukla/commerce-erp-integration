import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";
import openwhisk from "openwhisk";

import { erp } from "#lib/erp";
import { runMirror } from "#lib/mirror-run";

/** The worker that runs a mirror in the background (web: no, so no one-minute cut-off). */
export const MIRROR_JOB = "erp/mirror-job";

function wantsBackground(params) {
  return params.background === true || params.background === "true";
}

/**
 * POST mirror: read Commerce products, stock and companies into the ERP (the import
 * half of reset).
 *
 * POST mirror?background=true: start that in the background and answer 202 at once.
 * A web request is cut off after one minute and a mirror can take longer; the ERP's
 * Sync records button asks this way and watches its own last-import time.
 */
async function main(params) {
  const logger = AioLogger("erp-mirror", { level: params.LOG_LEVEL || "info" });
  try {
    if (wantsBackground(params)) {
      // Recorded before the worker starts, so either screen can say "starting" at once.
      await erp.reportSync(params, { state: "requested" }).catch((error) => {
        logger.warn(`sync report failed: ${error.message}`);
      });
      const activation = await openwhisk().actions.invoke({
        blocking: false,
        name: MIRROR_JOB,
        params: params.projectName ? { projectName: params.projectName } : {},
      });
      logger.info(
        `mirror started in the background (${activation.activationId})`,
      );
      return {
        body: { activationId: activation.activationId, started: true },
        statusCode: 202,
      };
    }
    const result = await runMirror(params);
    logger.info(
      `mirrored ${result.counts.products} products and ${result.counts.companies} companies`,
    );
    return ok({ body: result });
  } catch (error) {
    logger.error(`mirror failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
