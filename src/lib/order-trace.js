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
    failed: `Taken by ${erpName}; its number did not reach Commerce`,
    held: `Waiting for ${erpName}`,
    sending: `Sending to ${erpName}`,
    sent: `Sent to ${erpName}`,
  };
  return step(
    crossing.lastAt,
    "integration",
    what[crossing.outcome] ?? `Sent to ${erpName}`,
    crossing,
  );
}

/** How one part's send reads, by the part's status (lib/order-parts.js). */
function partWhat(part) {
  const name = part.erpName;
  if (part.status === "failed") {
    return part.refused ? `Refused by ${name}` : `Not taken by ${name}`;
  }
  const what = {
    cancelled: `Cancelled by ${name}`,
    held: `Waiting for ${name}`,
    sending: `Sending to ${name}`,
  };
  return what[part.status] ?? `Sent to ${name}`;
}

/**
 * With several ERPs, the order's send as one step per part, each naming its own ERP and saying
 * why it waits: the order's one history record speaks for every part at once, so its words
 * cannot name the ERP a part waits for (Bodea 2026-09-28, order 3000000022).
 */
function partSteps(crossing, parts) {
  return parts.map((part) =>
    step(crossing.lastAt, "integration", partWhat(part), {
      message: part.message,
      outcome: part.status,
      ref: crossing.ref,
    }),
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
 * @param {Array<{erpName: string, erpOrder: object|null, number: string}>} [input.erpOrders] -
 *   with several ERPs, each ERP holding a part of the order and its sales order (null when it
 *   did not answer); `erpOrder` is then the first that answered
 * @param {Array<{erpName: string, status: string, message?: string, refused?: boolean}>} [input.parts] -
 *   with several ERPs, the order's parts in list order: the order's send is then one step per part
 * @returns {{summary: object, steps: object[]}} the summary, and the steps oldest first
 */
export function buildOrderTrace({
  commerceOrder,
  commerceUnavailable = false,
  crossings,
  erpName,
  erpOrder: oneErpOrder,
  erpOrders,
  incrementId,
  parts,
}) {
  const sides = erpOrders ?? [{ erpName, erpOrder: oneErpOrder }];
  const erpOrder = sides.find((side) => side.erpOrder)?.erpOrder ?? null;
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
    if (crossing.direction !== "to-erp") {
      steps.push(returnStep(crossing));
    } else if (crossing.kind === "order" && parts?.length > 0) {
      steps.push(...partSteps(crossing, parts));
    } else {
      steps.push(sendStep(crossing, erpName));
    }
  }
  for (const side of sides) {
    steps.push(...erpSteps(side.erpOrder, side.erpName));
  }
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
      ...erpsSummary(erpOrders, parts),
    },
  };
}

/**
 * With several ERPs, each ERP's side of the order: every part in list order when the parts are
 * known (so a part no ERP has taken yet is named too, with its status as `part`), else each ERP
 * holding the order.
 */
function erpsSummary(erpOrders, parts) {
  if (parts?.length > 0) {
    return {
      erps: parts.map((part) => {
        const side = erpOrders?.find((s) => s.erpName === part.erpName);
        return {
          ...erpSummary(side ?? { erpName: part.erpName }),
          number:
            side?.erpOrder?.number ?? side?.number ?? part.erpNumber ?? null,
          part: part.status,
        };
      }),
    };
  }
  return erpOrders ? { erps: erpOrders.map(erpSummary) } : {};
}

/** One ERP's side of a split order, for the summary. */
function erpSummary(side) {
  return {
    name: side.erpName,
    number: side.erpOrder?.number ?? side.number ?? null,
    status: side.erpOrder?.status ?? null,
  };
}
