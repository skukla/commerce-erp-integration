import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { erp } from "#lib/erp";
import { readPayload } from "#lib/webhook";

/** POST set-offline { offline: boolean }: makes the ERP answer 503 (a test of the store carrying on without it), forwarded to the ERP's settings. */
async function main(params) {
  const logger = AioLogger("erp-set-offline", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const body = readPayload(params);
    if (typeof body.offline !== "boolean") {
      return badRequest("offline must be true or false");
    }
    const res = await erp.patchSettings(params, { offline: body.offline });
    if (!res.ok) {
      return internalServerError(
        `ERP settings answered ${res.status}: ${res.data?.errorMessage || "unknown error"}`,
      );
    }
    logger.info(`ERP ${body.offline ? "taken offline" : "brought online"}`);
    return ok({ body: res.data });
  } catch (error) {
    logger.error(`set-offline failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
