import {
  exceptionOperation,
  ok,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { paramsForErp } from "#adapters/contract";
import { erpRequest } from "#lib/erp";
import { listErps, loadErps } from "#lib/erps";
import { erpCustomerOf } from "#lib/key-map";
import { orderSyncDeps } from "#lib/order-deps";
import { assessPlacement, creditVerdict } from "#lib/placement-checks";
import { readPayload } from "#lib/webhook";
import { splitLines } from "#router/route-order";

/*
 * plugin.sales.api.order_management.place (before): the live checks as the order is placed
 * (pricing-and-live-checks.md; AB-19, AB-20). Each owning ERP is asked once — can the
 * company carry its part (credit), and by when can it promise the quantity (availability).
 *
 * Commerce aborts a hook at its hard timeout (10 s, app.commerce.config.ts) and — on the
 * Cloud Service — runs every hook as required, so an ABORTED hook stops the order. The ERP
 * calls therefore time out well inside that: 4 s each, credit and availability asked in
 * parallel per ERP, so two ERPs fit. A slow or down ERP answers "unavailable" and the order
 * goes through (fail-open, lib/placement-checks.js); only a definitive credit "no" stops it,
 * with the ERP's reason shown to the shopper.
 */
const ERP_TIMEOUT_MS = 4000;

/** Commerce's outcome untouched: the order places. */
const ALLOW = ok(successOperation());

/** What an ERP answered, or why it could not (never a block). */
function answerOf(res) {
  if (!res.ok) {
    throw new Error(`the ERP answered ${res.status}`);
  }
  return res.data;
}

/**
 * The collaborators over the real ERPs, Commerce and the key map (lib/placement-checks.js
 * names the shape). The ERP list and the "is this mine" split are the router's own
 * (lib/order-deps.js, router/route-order.js splitLines): the placement checks route an order
 * the way the send will.
 */
export function placementDeps(params, logger) {
  const sync = orderSyncDeps(logger);
  return {
    availability: async (erp, lines) => {
      const res = await erpRequest(paramsForErp(params, erp), "products", {
        body: { lines },
        method: "POST",
        path: "/availability",
        timeoutMs: ERP_TIMEOUT_MS,
      });
      return answerOf(res).lines ?? [];
    },
    companyIdOf: (order) =>
      order.customer_id === undefined || order.customer_id === null
        ? Promise.resolve(null)
        : sync.companyIdOf(params, order.customer_id),
    creditCheck: async (erp, partnerId, net, currency) => {
      const res = await erpRequest(paramsForErp(params, erp), "partners", {
        body: { currency, net },
        method: "POST",
        path: `/${encodeURIComponent(partnerId)}/credit-check`,
        timeoutMs: ERP_TIMEOUT_MS,
      });
      return answerOf(res);
    },
    erpCustomerOf,
    logger,
    splitByErp: async (order) => {
      const stored = await loadErps(params);
      const erps = stored.length > 0 ? stored : listErps(params);
      const { byErp } = await splitLines(params, order, erps, sync);
      return erps
        .filter((entry) => byErp.has(entry.id))
        .map((entry) => ({ erp: entry, lines: byErp.get(entry.id) }));
    },
  };
}

/** One line for the log: what each ERP said. */
function summary(assessment) {
  return assessment.results
    .map((r) => {
      const promised = Array.isArray(r.promises)
        ? `${r.promises.filter((p) => p.canPromiseNow).length}/${r.promises.length} promised now`
        : "availability unavailable";
      return `${r.erpName}: credit ${r.credit.status ?? "n/a"} (net ${r.credit.net}); ${promised}`;
    })
    .join(" | ");
}

async function main(params) {
  const logger = AioLogger("webhook-placement", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const payload = readPayload(params);
    // The plugin hook carries the order at the top level; the observer form nests it.
    const order = payload.order ?? payload.data?.order ?? payload;
    if (!order?.items) {
      logger.info(
        `no order lines in the payload (keys: ${Object.keys(payload).join(", ") || "none"}); the order goes through`,
      );
      return ALLOW;
    }
    const assessment = await assessPlacement(order, {
      ...placementDeps(params, logger),
      currency: order.base_currency_code || "USD",
    });
    logger.info(`placement checks — ${summary(assessment) || "no owning ERP"}`);
    const verdict = creditVerdict(assessment);
    if (verdict.block) {
      logger.info(`order refused: ${verdict.reason}`);
      return ok(exceptionOperation(verdict.reason));
    }
    return ALLOW;
  } catch (error) {
    // Fail open: a check that cannot run must not stop a buyer checking out.
    logger.error(
      `placement checks failed, the order goes through: ${error.message}`,
    );
    return ALLOW;
  }
}

export { main };
