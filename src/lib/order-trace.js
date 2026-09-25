import { splitExtOrderId } from "#lib/structure";

/*
 * One order's whole life, in one list.
 *
 * "Where is order 1042?" is the question a store operator asks when a buyer calls, and
 * answering it today means three screens: the Commerce order, this integration's history,
 * and the ERP's own order. Each holds part of the story and none holds the order of it.
 *
 * So this merges them by time: Commerce placed it, the integration sent it (or is still
 * holding it, and why), the ERP did things to it, and each of those came back as an event
 * that was applied to Commerce — or was not, which is exactly when the two sides disagree.
 *
 * Pure: the action fetches, this arranges. Anything missing is simply absent — an ERP that
 * never got the order contributes no steps rather than a guessed one.
 */

/** What the ERP's own status history calls each state, in the words the page shows. */
const ERP_STATUS = {
  cancelled: "cancelled it",
  confirmed: "confirmed it",
  created: "created sales order",
  invoiced: "invoiced it",
  shipped: "shipped it",
};

/** What an ERP event that came back is called, by the kind the history recorded. */
const CROSSING_SUBJECT = {
  cancel: "Cancellation",
  invoice: "Invoice",
  "order-status": "Status",
  shipment: "Shipment",
};

/** The outcomes that mean it did not get through (lib/history.js keeps the same set). */
const NOT_THROUGH = new Set(["held", "dropped", "failed", "refused"]);

/** A step, with the failure fields only when there was a failure. */
function step(at, where, what, crossing) {
  const outcome = crossing?.outcome;
  return {
    at,
    what,
    where,
    ...(crossing?.message ? { detail: crossing.message } : {}),
    ...(outcome ? { outcome } : {}),
    ...(crossing?.attempts > 1 ? { tries: crossing.attempts } : {}),
    ...(crossing && NOT_THROUGH.has(outcome)
      ? { retry: retryFor(crossing) }
      : {}),
  };
}

/** What a Retry of this crossing sends: an ERP event by its id, an order by its number. */
function retryFor(crossing) {
  return crossing.eventId
    ? { eventId: crossing.eventId }
    : { incrementId: crossing.ref };
}

/** The send to the ERP, as one step: sent, or still waiting, or not sent at all. */
function sendStep(crossing, erpName) {
  const what = {
    dropped: `Not sent to ${erpName}`,
    held: `Waiting for ${erpName}`,
    sent: `Sent to ${erpName}`,
  };
  return step(
    crossing.lastAt,
    "integration",
    what[crossing.outcome] ?? `Sent to ${erpName}`,
    crossing,
  );
}

/** One ERP event coming back, as one step — applied to Commerce, or not. */
function returnStep(crossing) {
  const subject = CROSSING_SUBJECT[crossing.kind] ?? "Update";
  const applied = crossing.outcome === "applied";
  return step(
    crossing.lastAt,
    "integration",
    `${subject} ${applied ? "applied to" : "not applied to"} Commerce`,
    crossing,
  );
}

/** What the ERP itself did, from its own status history. */
function erpSteps(erpOrder, erpName) {
  return (erpOrder?.history ?? []).map((entry) => {
    const said = ERP_STATUS[entry.status] ?? entry.status;
    const what =
      entry.status === "created"
        ? `${erpName} created sales order ${erpOrder.number}`
        : `${erpName} ${said}`;
    return step(entry.at, "erp", what);
  });
}

/**
 * One order, as everything that happened to it.
 *
 * @param {object} input
 * @param {object|null} input.commerceOrder - the Commerce order, or null when it has none
 * @param {object[]} input.crossings - this order's history records, either direction
 * @param {string} input.erpName - what the SC calls this ERP
 * @param {object|null} input.erpOrder - the ERP's own order, or null when it never arrived
 * @returns {{summary: object, steps: object[]}} the summary, and the steps oldest first
 */
export function buildOrderTrace({
  commerceOrder,
  commerceUnavailable = false,
  crossings,
  erpName,
  erpOrder,
  incrementId,
}) {
  const steps = [];
  if (commerceOrder) {
    steps.push(
      step(
        commerceOrder.created_at,
        "commerce",
        `Order ${commerceOrder.increment_id} placed`,
      ),
    );
  }
  for (const crossing of crossings ?? []) {
    steps.push(
      crossing.direction === "to-erp"
        ? sendStep(crossing, erpName)
        : returnStep(crossing),
    );
  }
  steps.push(...erpSteps(erpOrder, erpName));
  steps.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  return {
    steps,
    summary: {
      // False when Commerce did not answer (a timeout), as opposed to having no such order:
      // the steps then come from the history and the ERP alone.
      commerceAnswered: !commerceUnavailable,
      commerceStatus: commerceOrder?.status ?? null,
      erpNumber:
        erpOrder?.number ??
        splitExtOrderId(commerceOrder?.ext_order_id).number ??
        null,
      erpStatus: erpOrder?.status ?? null,
      incrementId:
        commerceOrder?.increment_id ??
        (commerceUnavailable ? (incrementId ?? null) : null),
      reachedErp: Boolean(erpOrder),
    },
  };
}
