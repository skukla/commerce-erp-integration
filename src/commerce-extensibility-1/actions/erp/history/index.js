import {
  badRequest,
  buildErrorResponse,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";
import openwhisk from "openwhisk";

import { getOrderByIncrementId } from "#lib/commerce";
import { erp } from "#lib/erp";
import { HANDLER_ACTIONS, readErpEvent } from "#lib/erp-event-history";
import { readHistory, recordOrderOutcome } from "#lib/history";
import { orderSyncDeps } from "#lib/order-deps";
import { retryOrderToErp } from "#lib/order-sync";
import { buildOrderTrace } from "#lib/order-trace";
import { splitExtOrderId } from "#lib/structure";
import { readPayload } from "#lib/webhook";

/** Order numbers are letters, digits and dashes; anything else never reaches Commerce. */
const ORDER_NUMBER = /^[A-Za-z0-9-]{1,50}$/u;
/** CloudEvent ids here are UUIDs; the same characters, a little longer. */
const EVENT_ID = /^[A-Za-z0-9-]{1,100}$/u;
const NOT_FOUND = 404;
/** The ERP is asked for one order inside a page load, so it waits no longer than this. */
const TRACE_TIMEOUT_MS = 5000;

/**
 * The Commerce Admin screen's history (lib/history.js).
 * GET ?failedOnly=true&ref=<order>: the records, newest first.
 * POST { incrementId }: send that order to the ERP again, record it as an admin's retry,
 *   and answer how it ended with the order's record. An order that still did not get
 *   through is an answer, not an error: the record says why.
 * POST { eventId }: hand that ERP event, as it was saved, to its handler again (the
 *   handler records itself, marked as an admin's retry), and answer its record.
 */
async function main(params) {
  const logger = AioLogger("erp-history", {
    level: params.LOG_LEVEL || "info",
  });
  const method = String(params.__ow_method || "get").toLowerCase();
  try {
    if (method === "post") {
      const { eventId, incrementId } = readPayload(params);
      if (eventId !== undefined) {
        return await retryErpEvent(eventId, logger);
      }
      if (typeof incrementId !== "string" || !ORDER_NUMBER.test(incrementId)) {
        return badRequest("Name the order to retry by its order number.");
      }
      const result = await retryOrderToErp(
        params,
        incrementId,
        orderSyncDeps(logger),
      );
      logger.info(`retry: ${result.message}`);
      await recordOrderOutcome({ increment_id: incrementId }, result, {
        logger,
        retriedBy: "admin",
      });
      const [entry] = await readHistory({ ref: incrementId });
      return ok({
        body: { entry, message: result.message, outcome: result.outcome },
      });
    }
    if (params.trace !== undefined) {
      const incrementId = String(params.trace);
      if (!ORDER_NUMBER.test(incrementId)) {
        return badRequest("Name the order to follow by its order number.");
      }
      return ok({
        body: { trace: await traceOrder(params, incrementId, logger) },
      });
    }
    const entries = await readHistory({
      failedOnly: params.failedOnly === "true",
      ...(params.ref ? { ref: String(params.ref) } : {}),
    });
    return ok({ body: { entries } });
  } catch (error) {
    logger.error(`history failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

/** Hand one saved ERP event to its handler again; the handler records how it ended. */
async function retryErpEvent(eventId, logger) {
  if (typeof eventId !== "string" || !EVENT_ID.test(eventId)) {
    return badRequest("Name the ERP event to retry by its id.");
  }
  const saved = await readErpEvent(eventId);
  const name = saved && HANDLER_ACTIONS[saved.kind];
  if (!name) {
    return buildErrorResponse(NOT_FOUND, {
      body: { message: `The history has no ERP event ${eventId}.` },
    });
  }
  await openwhisk().actions.invoke({
    blocking: true,
    name,
    params: {
      __retriedBy: "admin",
      data: saved.event.data,
      id: eventId,
      type: saved.event.type,
    },
    result: true,
  });
  const entry = await readErpEvent(eventId);
  logger.info(`retry of ERP event ${eventId}: ${entry?.outcome}`);
  return ok({
    body: { entry, message: entry?.message, outcome: entry?.outcome },
  });
}

/**
 * One order as all three sides know it: Commerce's own order, this integration's record of
 * what crossed, and — when the order reached it — the ERP's sales order with its status
 * history. An ERP that cannot be reached, or never got the order, simply contributes
 * nothing: the Commerce half is still the answer to "where is my order?".
 */
async function traceOrder(params, incrementId, logger) {
  let commerceUnavailable = false;
  const [commerceOrder, crossings] = await Promise.all([
    getOrderByIncrementId(params, incrementId).catch((error) => {
      logger.warn(`trace: Commerce order ${incrementId}: ${error.message}`);
      commerceUnavailable = true;
      return null;
    }),
    readHistory({ ref: incrementId }),
  ]);
  // The Commerce field carries this pair's prefix (rule M4); the ERP is asked by number.
  // When Commerce did not answer, the ERP is asked by the order's reference instead, so a
  // slow Commerce read does not also lose the ERP half of the story.
  const erpNumber =
    splitExtOrderId(commerceOrder?.ext_order_id).number ??
    (commerceUnavailable
      ? await erpNumberByReference(params, incrementId, logger)
      : undefined);
  const answered = erpNumber
    ? await erp.order(params, erpNumber, TRACE_TIMEOUT_MS).catch((error) => {
        logger.warn(`trace: ERP order ${erpNumber}: ${error.message}`);
        return { ok: false };
      })
    : { ok: false };
  return buildOrderTrace({
    commerceOrder,
    commerceUnavailable,
    crossings,
    erpName: params.ERP_DISPLAY_NAME || "the ERP",
    erpOrder: answered.ok ? answered.data : null,
    incrementId,
  });
}

/** The ERP's number for the order carrying this reference, or undefined. Never throws. */
async function erpNumberByReference(params, incrementId, logger) {
  try {
    const answer = await erp.ordersByReference(
      params,
      incrementId,
      TRACE_TIMEOUT_MS,
    );
    return answer.ok ? answer.data?.items?.[0]?.number : undefined;
  } catch (error) {
    logger.warn(`trace: ERP orders for ${incrementId}: ${error.message}`);
  }
}

export { main };
