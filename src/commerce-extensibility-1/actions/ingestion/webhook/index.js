import { publishEvent } from "@adobe/aio-commerce-lib-app";
import { resolveImsAuthParams } from "@adobe/aio-commerce-sdk/auth";
import { CommerceSdkValidationError } from "@adobe/aio-commerce-sdk/core/error";
import {
  badRequest,
  buildErrorResponse,
  HTTP_OK,
  internalServerError,
  ok,
  unauthorized,
} from "@adobe/aio-commerce-sdk/core/responses";
import { createAdobeIoEventsApiClient } from "@adobe/aio-commerce-sdk/events/io-events";
import AioLogger from "@adobe/aio-lib-core-logging";

import appConfig from "#app.commerce.config";
import { eventErpId, loadErps } from "#lib/erps";
import { isErpEcho } from "#lib/own-writes";
import { stringParameters } from "#lib/utils";
import {
  erpChangeOf,
  translateErpEvent,
  validateCloudEvent,
} from "#src/ingestion/translate";

import { checkAuthentication } from "./auth.js";

const BACKOFFICE_PROVIDER_KEY = appConfig.eventing.external[0].provider.key;

/**
 * One ERP event in, the starter-kit events it means out: validate the CloudEvent, translate it
 * (#src/ingestion/translate, the one place the ERP's words are read), and publish each.
 * Separate from `main` so the pair-in-a-box journeys drive this very path with their own publish.
 *
 * @param {object} params the action params: the CloudEvent the ERP posted, and credentials
 * @param {{ publish: (event: string, payload: object) => Promise<void>, findOrder?: Function,
 *   logger?: object }} deps
 * @returns {Promise<object>} the action response
 */
export async function ingestErpEvent(params, deps) {
  const validation = validateCloudEvent(params);
  if (!validation.success) {
    deps.logger?.error(`Validation failed with error: ${validation.message}`);
    return badRequest(validation.message);
  }
  const translated = await translateErpEvent(params, params, deps);
  if (!translated.ok) {
    deps.logger?.error(
      `ERP event ${params.id} not translated: ${translated.message}`,
    );
    return buildErrorResponse(translated.statusCode, {
      body: { message: translated.message },
    });
  }
  if (translated.skipped) {
    deps.logger?.info(`ERP event ${params.id}: ${translated.skipped}`);
  }
  const echo = await echoOf(params, translated, deps);
  if (echo) {
    deps.logger?.info(`ERP event ${params.id}: ${echo}`);
    return ok({
      body: {
        published: [],
        response: { message: echo, success: true },
        type: params.type,
      },
    });
  }
  for (const { event, payload } of translated.events) {
    deps.logger?.debug(
      `Publish event ${event} to provider ${BACKOFFICE_PROVIDER_KEY}`,
    );
    // biome-ignore lint/performance/noAwaitInLoops: published in the order the change means them
    await deps.publish(event, payload);
  }
  return ok({
    body: {
      published: translated.events.map((e) => e.event),
      response: {
        message: translated.skipped ?? "Event published successfully",
        success: true,
      },
      type: params.type,
    },
  });
}

/**
 * Why an ERP event is the echo of a change this integration sent that ERP for a move made in
 * Commerce, or null when it is not (AB-26y step 5): the ERP raises its events for every change
 * (its contract version 19), and the move is already in Commerce. lib/own-writes.js remembers
 * each change sent; the record is used up here. The ERP is named as an ERP event is attributed
 * (lib/erps eventErpId), as the change was recorded under it.
 */
async function echoOf(params, translated, deps) {
  const change =
    translated.events.length > 0 ? erpChangeOf(params.type, params.data) : null;
  if (!change) {
    return null;
  }
  const erps = deps.erps ?? (await loadErps(params));
  const erpId = eventErpId(erps, translated.erpId);
  if (!(erpId && (await isErpEcho({ ...change, erpId })))) {
    return null;
  }
  return `sales order ${change.salesOrder}: the ERP raised the ${change.kind} this integration sent it for a change made in Commerce; nothing to publish`;
}

/**
 * The ERP's events reach Commerce here: the ERP posts a CloudEvent in its own words (its
 * contract version 16), and the starter-kit events it means are published to I/O Events for
 * the back-office handlers.
 *
 * @param {object} params - method params includes environment and request data
 * @returns response with success status and result
 */
async function main(params) {
  const logger = AioLogger("ingestion-webhook", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    logger.info("Start processing request");
    logger.debug(`Webhook main params: ${stringParameters(params)}`);
    const authentication = checkAuthentication(params);
    // biome-ignore lint/suspicious/noUnnecessaryConditions: checkAuthentication's scaffold returns success until implemented.
    if (!authentication.success) {
      logger.error(
        `Authentication failed with error: ${authentication.message}`,
      );
      return unauthorized(authentication.message);
    }
    logger.info(`Process ERP event ${params.type}`);
    let client;
    const publish = async (event, payload) => {
      client ??= createAdobeIoEventsApiClient({
        auth: resolveImsAuthParams(params),
      });
      await publishEvent({
        client,
        event,
        payload,
        provider: BACKOFFICE_PROVIDER_KEY,
      });
    };
    const response = await ingestErpEvent(params, { logger, publish });
    logger.info(
      `Request answered: ${response.statusCode ?? response.error?.statusCode ?? HTTP_OK}`,
    );
    return response;
  } catch (error) {
    logger.error(`Server error: ${error.message}`);
    if (error instanceof CommerceSdkValidationError) {
      logger.error(error.display());
    }
    return internalServerError(error.message);
  }
}

export { main };
