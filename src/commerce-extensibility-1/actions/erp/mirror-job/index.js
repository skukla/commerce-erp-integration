import AioLogger from "@adobe/aio-lib-core-logging";

import { runMirror } from "#lib/mirror-run";

/**
 * The background mirror `erp/mirror?background=true` starts. Not a web action, so the
 * one-minute cut-off on web requests does not apply; its outcome is in its activation
 * log, and in the ERP's last-import time.
 */
async function main(params) {
  const logger = AioLogger("erp-mirror-job", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const result = await runMirror(params);
    logger.info(
      `mirrored ${result.counts.products} products and ${result.counts.companies} companies`,
    );
    return { counts: result.counts, ok: true };
  } catch (error) {
    logger.error(`background mirror failed: ${error.message}`);
    return { error: error.message, ok: false };
  }
}

export { main };
