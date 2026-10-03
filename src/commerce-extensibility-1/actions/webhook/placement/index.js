import {
  exceptionOperation,
  ok,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { paramsForErp } from "#adapters/contract";
import { erpRequest } from "#lib/erp";
import { availabilityOf } from "#lib/erp-availability";
import { listErps, loadErps } from "#lib/erps";
import { erpCustomerOf } from "#lib/key-map";
import { orderSyncDeps } from "#lib/order-deps";
import { ownershipReaders } from "#lib/ownership-readers";
import { assessPlacement, creditVerdict } from "#lib/placement-checks";
import { ownsLine } from "#lib/structure";
import { readPayload } from "#lib/webhook";
import { linesOf, splitLines } from "#router/route-order";

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

/**
 * The whole check's limit, inside Commerce's 10 s hard timeout. The ERP calls have their own
 * 4 s limit, but the Commerce reads before them (the buyer's company, each line's owner) have
 * none, and on a slow store they ran to 16 s, so Runtime killed the action and Commerce
 * refused every order with the fallback message (measured on Justrite 2026-10-02, AB-55).
 * Past this, the order goes through: the same fail-open rule as a slow ERP.
 */
export const PLACEMENT_DEADLINE_MS = 8000;

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
  // Each line's owner from ONE Commerce search for the order's SKUs, not one read per line
  // per ERP (lib/ownership-readers.js). The split asks nothing about variants: the variant
  // check (one read per configurable) is the router's, run when the order is sent.
  const readers = ownershipReaders();
  const split = {
    logger,
    ownsSku: (p, sku, settings, websiteCode) =>
      ownsLine(p, { sku, websiteCode }, settings, readers),
    // The order's website, for an ERP that owns by website (AB-64): the same cached store
    // read the send uses.
    websiteCodeOf: sync.websiteCodeOf,
  };
  return {
    // The same call the router makes when it records the promise on the part
    // (lib/erp-availability.js); here it is an early signal while the shopper waits.
    availability: (erp, lines) =>
      availabilityOf(params, erp, lines, ERP_TIMEOUT_MS),
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
      readers.expect(linesOf(order).map((line) => line.sku));
      const { byErp } = await splitLines(params, order, erps, split);
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

/** The checks' answer, or null when they are still running at the deadline. */
async function withinDeadline(checks) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), PLACEMENT_DEADLINE_MS);
  });
  try {
    return await Promise.race([checks, deadline]);
  } finally {
    clearTimeout(timer);
  }
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
    const assessment = await withinDeadline(
      assessPlacement(order, {
        ...placementDeps(params, logger),
        currency: order.base_currency_code || "USD",
      }),
    );
    if (!assessment) {
      logger.warn(
        `placement checks did not finish in ${PLACEMENT_DEADLINE_MS} ms; the order goes through`,
      );
      return ALLOW;
    }
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
