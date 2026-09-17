/*
 * The mirror as an action runs it: Commerce's readers, the ERP client, the project
 * name, and the ERP's sync record kept up to date. Shared by `erp/mirror` (inline),
 * `erp/mirror-job` (the background worker) and `erp/reset`, so they cannot differ
 * about what a mirror is or what a screen is told.
 */
import AioLogger from "@adobe/aio-lib-core-logging";

import {
  listCompanies,
  listProducts,
  listSources,
  listStock,
} from "#lib/commerce";
import { erp } from "#lib/erp";
import { mirror } from "#lib/mirror";

const NO_ASSOCIATION = /No association record/u;
const COMMERCE_REFUSED =
  /\b401\b.*commerce\.adobe\.com|commerce\.adobe\.com.*\b401\b/u;

/**
 * The reason a person reads when a sync fails. Known causes get the step that fixes
 * them; anything else keeps its own words.
 */
export function syncFailureText(error) {
  const message = error?.message ?? String(error);
  if (
    error?.name === "AssociationRecordNotFoundError" ||
    NO_ASSOCIATION.test(message)
  ) {
    return "The integration is not connected to a Commerce instance. Install it into Commerce again from Demo Builder.";
  }
  if (COMMERCE_REFUSED.test(message)) {
    return "Commerce refused the integration's credential (401). The workspace needs the Adobe Commerce as a Cloud Service API; redeploying the integration from Demo Builder subscribes it.";
  }
  return message;
}

/**
 * Report one sync step to the ERP. A report that fails is logged and ignored: the
 * mirror matters more than the progress line.
 */
function reporter(params, logger) {
  return async (step) => {
    try {
      const res = await erp.reportSync(params, step);
      if (!res.ok) {
        logger.warn(`sync report answered ${res.status}`);
      }
    } catch (error) {
      logger.warn(`sync report failed: ${error.message}`);
    }
  };
}

/**
 * Run a mirror and keep the ERP's sync record current, ending in done or failed.
 * @returns {Promise<object>} the mirror's result
 * @throws the mirror's error, after reporting it
 */
export async function runMirror(params) {
  const logger = AioLogger("erp-mirror-run", {
    level: params.LOG_LEVEL || "info",
  });
  const report = reporter(params, logger);
  try {
    const result = await mirror(
      params,
      { listCompanies, listProducts, listSources, listStock },
      erp,
      params.projectName,
      report,
    );
    await report({ state: "done" });
    return result;
  } catch (error) {
    await report({ error: syncFailureText(error), state: "failed" });
    throw error;
  }
}
