/*
 * The routing entry point for a placed order (design v1 §2). It knows no ERP: it reads the ERP
 * list, decides which ERP owns each of the order's lines, and hands each ERP its part through
 * that ERP's adapter.
 *
 * With one ERP in the list the part is the whole order, sent exactly as before routing
 * existed (pass-through). With several (slice B1):
 * - a line's owner is the ERP whose ownership setting owns its product, read through the one
 *   ownership rule the integration has (lib/structure.js). An ERP's ownership defaults to
 *   "the products whose erp_owner attribute holds this ERP's id": the attribute a product
 *   information system would master, holding the id that never changes (design v1 §2, §3.2);
 * - a line no ERP owns is held back and recorded; a line two ERPs claim is a setup error,
 *   recorded and sent to neither;
 * - each part is recorded (lib/order-parts.js) and sent once: a redelivered order event sends
 *   only the parts that did not reach their ERP.
 * The ERP number is not written onto the Commerce order by any one part; the combined view is
 * slice B2's.
 */
import { adapterFor, listErps } from "#lib/erps";
import {
  FINAL_OUTCOMES,
  readOrderParts,
  writeOrderParts,
} from "#lib/order-parts";
import { ownersOf } from "#router/ownership";

const SERVER_UNAVAILABLE = 503;
const BAD_REQUEST = 400;

function linesOf(order) {
  const items = order?.items ?? [];
  return Array.isArray(items) ? items : Object.values(items);
}

/**
 * Group an order's lines by owning ERP. A configurable's child line travels with its parent.
 * @returns {Promise<{ byErp: Map<string, object[]>, unrouted: string[], conflicts: object[] }>}
 */
async function splitLines(params, order, erps, deps) {
  const lines = linesOf(order);
  const byErp = new Map();
  const unrouted = [];
  const conflicts = [];
  const ownerOfItem = new Map();
  for (const line of lines.filter((l) => !l.parent_item_id && l.sku)) {
    // biome-ignore lint/performance/noAwaitInLoops: a few lines, in order
    const owners = await ownersOf(params, line.sku, erps, deps.ownsSku);
    if (owners.length === 0) {
      unrouted.push(line.sku);
    } else if (owners.length > 1) {
      conflicts.push({ erps: owners, sku: line.sku });
    } else {
      ownerOfItem.set(line.item_id, owners[0]);
    }
  }
  for (const line of lines) {
    const owner = ownerOfItem.get(line.parent_item_id ?? line.item_id);
    if (owner) {
      byErp.set(owner, [...(byErp.get(owner) ?? []), line]);
    }
  }
  return { byErp, conflicts, unrouted };
}

/** One answer for the event delivery, from each part's outcome. */
function combine(label, outcomes, notes) {
  const all = Object.values(outcomes);
  const message = [...all.map((o) => o.message), ...notes].join(" ");
  if (all.some((o) => o.outcome === "held" || o.outcome === "failed")) {
    return { message, outcome: "held", statusCode: SERVER_UNAVAILABLE };
  }
  if (all.some((o) => o.outcome === "sent")) {
    return { message, outcome: "sent", statusCode: 200 };
  }
  if (all.length === 0 && notes.length > 0) {
    return { message, outcome: "dropped", statusCode: BAD_REQUEST };
  }
  return {
    message: message || `${label}: every part was already sent.`,
    outcome: "skipped",
    statusCode: 200,
  };
}

async function routeToSeveral(params, order, deps, erps) {
  const label = `order ${order.increment_id}`;
  const { byErp, unrouted, conflicts } = await splitLines(
    params,
    order,
    erps,
    deps,
  );
  const record = await readOrderParts(order.increment_id);
  record.unrouted = unrouted;
  record.conflicts = conflicts;
  const outcomes = {};
  for (const entry of erps.filter((e) => byErp.has(e.id))) {
    const lines = byErp.get(entry.id);
    const known = record.parts[entry.id];
    if (known && FINAL_OUTCOMES.includes(known.status)) {
      continue;
    }
    record.parts[entry.id] = {
      // Commerce's order item ids: the part's shipments and invoices name its lines by them.
      itemIds: lines
        .map((l) => Number(l.item_id))
        .filter((id) => Number.isFinite(id)),
      skus: lines.filter((l) => !l.parent_item_id).map((l) => l.sku),
      status: "sending",
    };
    // biome-ignore lint/performance/noAwaitInLoops: the record is saved before each send
    await writeOrderParts(order.increment_id, record);
    const outcome = await adapterFor(entry).sendPart(
      params,
      { erp: entry, lines, order, shared: true },
      deps,
    );
    record.parts[entry.id] = {
      ...record.parts[entry.id],
      ...(outcome.erpNumber ? { erpNumber: outcome.erpNumber } : {}),
      message: outcome.message,
      status: outcome.outcome,
    };
    await writeOrderParts(order.increment_id, record);
    outcomes[entry.id] = outcome;
  }
  if (Object.keys(outcomes).length === 0) {
    await writeOrderParts(order.increment_id, record);
  }
  const notes = [
    ...unrouted.map(
      (sku) => `${label}: ${sku} belongs to no ERP and was held back.`,
    ),
    ...conflicts.map(
      (c) =>
        `${label}: ${c.sku} is claimed by ${c.erps.join(" and ")}; fix the setup.`,
    ),
  ];
  return combine(label, outcomes, notes);
}

/**
 * Route one placed order.
 * @param {object} params action params
 * @param {object} order the Commerce order the event carries
 * @param {object} deps the collaborators the adapters send with (lib/order-deps.js)
 * @param {import("#adapters/contract").ErpEntry[]} [erps] the ERP list; else the one
 *   `deps.loadErps` answers, else the single ERP from the settings
 * @returns {Promise<import("#adapters/contract").PartOutcome>}
 */
export function routeOrder(params, order, deps, erps) {
  if (erps) {
    return routeOver(params, order, deps, erps);
  }
  // The stored list (Demo Builder writes it, slice B3a), when the collaborators can load it;
  // a list that cannot be read fails the delivery rather than routing to the wrong ERP.
  if (deps?.loadErps) {
    return deps
      .loadErps(params)
      .then((list) => routeOver(params, order, deps, list));
  }
  return routeOver(params, order, deps, listErps(params));
}

function routeOver(params, order, deps, erps) {
  const [first] = erps;
  if (erps.length === 1 || !order?.increment_id) {
    // One ERP, or the save that only wrote an ERP number back: exactly today's send.
    return adapterFor(first).sendPart(
      params,
      { erp: first, lines: linesOf(order), order },
      deps,
    );
  }
  return routeToSeveral(params, order, deps, erps);
}
