/*
 * The routing entry point for a placed order (design v1 §2). It knows no ERP: it reads the ERP
 * list, decides which ERP owns each of the order's lines, and hands each ERP its part through
 * that ERP's adapter.
 *
 * With one ERP in the list the part is the whole order, sent exactly as before routing
 * existed (pass-through), except that a company's order is recorded as that ERP's one part and
 * waits while that ERP blocks the company: each ERP for itself, with one ERP too (owner,
 * 2026-09-28). With several (slice B1):
 * - a line's owner is the ERP whose ownership setting owns its product, read through the one
 *   ownership rule the integration has (lib/structure.js). An ERP's ownership defaults to
 *   "the products whose erp_owner attribute holds this ERP's id": the attribute a product
 *   information system would master, holding the id that never changes (design v1 §2, §3.2);
 * - a line no ERP owns is held back and recorded; a line two ERPs claim is a setup error,
 *   recorded and sent to neither;
 * - each part is recorded (lib/order-parts.js) and sent once: a redelivered order event sends
 *   only the parts that did not reach their ERP;
 * - a configurable product whose variants belong to different ERPs is a setup warning on the
 *   part its ordered variant went to (slice B7), never a reason to hold the order.
 * The ERP number is not written onto the Commerce order by any one part; the combined view is
 * slice B2's.
 */
import { isBlocked, noteCompanyOrder } from "#lib/erp-blocks";
import { adapterFor, listErps } from "#lib/erps";
import {
  FINAL_OUTCOMES,
  partStatusOf,
  readOrderParts,
  writeOrderParts,
} from "#lib/order-parts";
import { applyCombinedStatus } from "#router/combined-status";
import { ownersOf } from "#router/ownership";

const SERVER_UNAVAILABLE = 503;
const BAD_REQUEST = 400;

/** An order's lines, whether they come as a list or keyed by id. */
export function linesOf(order) {
  const items = order?.items ?? [];
  return Array.isArray(items) ? items : Object.values(items);
}

/**
 * Group an order's lines by owning ERP. A configurable's child line travels with its parent.
 * Exported for the placement checks (webhook/placement), which ask each owning ERP about its
 * own part before the order exists — the one split, used by both.
 * @returns {Promise<{ byErp: Map<string, object[]>, unrouted: string[], conflicts: object[],
 *   warnings: Map<string, string[]> }>}
 */
export async function splitLines(params, order, erps, deps) {
  const lines = linesOf(order);
  const byErp = new Map();
  const unrouted = [];
  const conflicts = [];
  const ownerOfItem = new Map();
  // A line's key: its item_id, or its place in the order when it has none. Before Commerce
  // saves the order (the placement check) no line has an id, and keying them all by the same
  // missing one sent every line to the last line's ERP (Justrite, 2026-10-02, AB-55).
  const keyOf = (line) => line.item_id ?? `line-${lines.indexOf(line)}`;
  for (const line of lines.filter((l) => !l.parent_item_id && l.sku)) {
    // biome-ignore lint/performance/noAwaitInLoops: a few lines, in order
    const owners = await ownersOf(params, line.sku, erps, deps.ownsSku);
    if (owners.length === 0) {
      unrouted.push(line.sku);
    } else if (owners.length > 1) {
      conflicts.push({ erps: owners, sku: line.sku });
    } else {
      ownerOfItem.set(keyOf(line), owners[0]);
    }
  }
  for (const line of lines) {
    const owner = ownerOfItem.get(line.parent_item_id ?? keyOf(line));
    if (owner) {
      byErp.set(owner, [...(byErp.get(owner) ?? []), line]);
    }
  }
  const warnings = await variantWarnings(
    params,
    lines,
    ownerOfItem,
    erps,
    deps,
  );
  return { byErp, conflicts, unrouted, warnings };
}

/**
 * The variant check (slice B7): a configurable product whose variants belong to different
 * ERPs is a setup mistake. The ordered variant still goes to its own ERP; the part it went to
 * records a warning. A check that cannot read the variants is logged, never an error: the
 * order is never held for it.
 * @returns {Promise<Map<string, string[]>>} warnings by the ERP id of the part
 */
async function variantWarnings(params, lines, ownerOfItem, erps, deps) {
  const warnings = new Map();
  if (!deps?.variantsOf) {
    return warnings;
  }
  const configurables = lines.filter(
    (l) =>
      l.product_type === "configurable" &&
      !l.parent_item_id &&
      ownerOfItem.has(l.item_id),
  );
  for (const line of configurables) {
    // biome-ignore lint/performance/noAwaitInLoops: few configurable lines, in order
    const warning = await variantWarning(params, line, erps, deps);
    if (warning) {
      const owner = ownerOfItem.get(line.item_id);
      warnings.set(owner, [...(warnings.get(owner) ?? []), warning]);
    }
  }
  return warnings;
}

async function variantWarning(params, line, erps, deps) {
  try {
    const { parentSku, skus } = await deps.variantsOf(params, line.product_id);
    const byOwner = new Map();
    for (const sku of skus) {
      for (const owner of await ownersOf(params, sku, erps, deps.ownsSku)) {
        byOwner.set(owner, [...(byOwner.get(owner) ?? []), sku]);
      }
    }
    if (byOwner.size <= 1) {
      return null;
    }
    const owners = [...byOwner]
      .map(([owner, owned]) => `${owner}: ${owned.join(", ")}`)
      .join("; ");
    return `${parentSku}'s variants belong to different ERPs (${owners}); fix the setup.`;
  } catch (error) {
    deps.logger?.warn?.(
      `variants of ${line.sku} not checked: ${error.message}`,
    );
    return null;
  }
}

/**
 * The ERP's available-to-promise for a part (AB-19), asked BEFORE the part is sent: once
 * the ERP holds this order it counts the order's own quantity against its stock, and the
 * promise would answer for the next order instead. Never a reason to hold: a check that
 * cannot run leaves no promise and the send goes on.
 * @returns {Promise<object[]|null>} the ERP's per-line promises, or null
 */
async function promisesFor(params, entry, lines, deps) {
  if (!deps?.promisesFor) {
    return null;
  }
  try {
    return await deps.promisesFor(params, entry, lines);
  } catch (error) {
    deps.logger?.warn?.(
      `${entry.name}: availability not asked: ${error.message}`,
    );
    return null;
  }
}

/** The buyer's Commerce company, or null (a guest, or a company that cannot be read). */
async function companyOfOrder(params, order, deps) {
  if (
    !deps?.companyIdOf ||
    order.customer_id === undefined ||
    order.customer_id === null
  ) {
    return null;
  }
  try {
    return await deps.companyIdOf(params, order.customer_id);
  } catch (error) {
    deps.logger?.warn?.(
      `order ${order.increment_id}: company not read: ${error.message}`,
    );
    return null;
  }
}

/**
 * The order with its Commerce id. The order event carries none (its subscription names no
 * `entity_id`), so the order is found by its number once, before the parts need it. Not found,
 * the order goes on without it: each part's send finds it again, or waits for it.
 */
async function withOrderId(params, order, deps) {
  if (order.entity_id !== undefined || !deps?.findOrder) {
    return order;
  }
  try {
    const found = await deps.findOrder(params, order.increment_id);
    return found ? { ...order, entity_id: found.entityId } : order;
  } catch (error) {
    deps.logger?.warn?.(
      `order ${order.increment_id}: not read from Commerce: ${error.message}`,
    );
    return order;
  }
}

/**
 * The order's combined status once its parts went: Partially Held while a part waits, On Hold
 * while every part does. A write that fails is logged, not retried: the parts are with their
 * ERPs, and delivering the event again would send nothing new.
 */
async function writeCombinedStatus(params, order, record, deps) {
  if (order.entity_id === undefined) {
    return;
  }
  try {
    await applyCombinedStatus(params, order.entity_id, record);
  } catch (error) {
    deps?.logger?.warn?.(
      `order ${order.increment_id}: status not written: ${error.message}`,
    );
  }
}

/** One answer for the event delivery, from each part's outcome. */
function combine(label, outcomes, notes) {
  const all = Object.values(outcomes);
  const message = [...all.map((o) => o.message), ...notes].join(" ");
  // A part a block holds waits for the unblock, which sends it; a part its ERP refused waits
  // for staff to send it again. Delivering the event again can help neither.
  const retryable = all.filter((o) => !(o.heldByBlock || o.refused));
  if (retryable.some((o) => o.outcome === "held" || o.outcome === "failed")) {
    return { message, outcome: "held", statusCode: SERVER_UNAVAILABLE };
  }
  if (all.some((o) => o.outcome === "sent")) {
    return { message, outcome: "sent", statusCode: 200 };
  }
  if (all.length > 0 && all.every((o) => o.refused)) {
    return { message, outcome: "dropped", statusCode: BAD_REQUEST };
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

async function routeToSeveral(params, event, deps, erps) {
  const order = await withOrderId(params, event, deps);
  const label = `order ${order.increment_id}`;
  const { byErp, unrouted, conflicts, warnings } = await splitLines(
    params,
    order,
    erps,
    deps,
  );
  const record = await readOrderParts(order.increment_id);
  record.unrouted = unrouted;
  record.conflicts = conflicts;
  const companyId = await companyOfOrder(params, order, deps);
  if (companyId) {
    record.companyId = companyId;
    if (order.entity_id !== undefined) {
      await noteCompanyOrder(companyId, order.increment_id, order.entity_id);
    }
  }
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
      ...(warnings.has(entry.id) ? { warnings: warnings.get(entry.id) } : {}),
    };
    // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, the record saved in order
    if (companyId && (await isBlocked(companyId, entry.id))) {
      const message = `${entry.name} blocks this company; its lines wait until it lifts the block.`;
      record.parts[entry.id] = {
        ...record.parts[entry.id],
        heldBy: "block",
        message,
        status: "held",
      };
      await writeOrderParts(order.increment_id, record);
      outcomes[entry.id] = { heldByBlock: true, message, outcome: "held" };
      continue;
    }
    await writeOrderParts(order.increment_id, record);
    const promises = await promisesFor(params, entry, lines, deps);
    const outcome = await adapterFor(entry).sendPart(
      params,
      { erp: entry, lines, order, shared: true },
      deps,
    );
    const status = partStatusOf(outcome);
    record.parts[entry.id] = {
      ...record.parts[entry.id],
      ...(outcome.erpNumber ? { erpNumber: outcome.erpNumber } : {}),
      ...(promises ? { promises } : {}),
      message: outcome.message,
      ...status,
    };
    await writeOrderParts(order.increment_id, record);
    outcomes[entry.id] =
      outcome.outcome === "dropped"
        ? { ...outcome, outcome: "failed", refused: true }
        : outcome;
  }
  if (Object.keys(outcomes).length === 0) {
    await writeOrderParts(order.increment_id, record);
  }
  await writeCombinedStatus(params, order, record, deps);
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

/** The whole order as its one ERP's part, for the parts record. */
function wholePart(order) {
  const lines = linesOf(order);
  return {
    itemIds: lines
      .map((l) => Number(l.item_id))
      .filter((id) => Number.isFinite(id)),
    skus: lines.filter((l) => !l.parent_item_id && l.sku).map((l) => l.sku),
  };
}

/**
 * One ERP: today's send, plus the bookkeeping a block needs for a company's order. A guest's
 * order touches no state. While the ERP blocks the company the order waits (answered as done
 * for the event: the unblock sends it, a redelivery could not).
 */
function routeToOne(params, order, deps, entry) {
  // The adapter first: an ERP of an unknown kind fails at once, before anything is read.
  const adapter = adapterFor(entry);
  const send = () =>
    adapter.sendPart(
      params,
      { erp: entry, lines: linesOf(order), order },
      deps,
    );
  return routeCompanyOrder(params, order, deps, entry, send);
}

async function routeCompanyOrder(params, event, deps, entry, send) {
  const companyId = await companyOfOrder(params, event, deps);
  if (!companyId) {
    return send();
  }
  const order = await withOrderId(params, event, deps);
  if (order.entity_id !== undefined) {
    await noteCompanyOrder(companyId, order.increment_id, order.entity_id);
  }
  const record = await readOrderParts(order.increment_id);
  record.companyId = companyId;
  if (await isBlocked(companyId, entry.id)) {
    const message = `${entry.name} blocks this company; the order waits until it lifts the block.`;
    record.parts[entry.id] = {
      ...wholePart(order),
      heldBy: "block",
      message,
      status: "held",
    };
    await writeOrderParts(order.increment_id, record);
    if (order.entity_id !== undefined) {
      // Staff see why the order waits: On Hold, with the reason in its history.
      await applyCombinedStatus(params, order.entity_id, record);
      await deps.addNote?.(params, order.entity_id, message);
    }
    return { message, outcome: "skipped", statusCode: 200 };
  }
  const promises = await promisesFor(params, entry, linesOf(order), deps);
  const outcome = await send();
  record.parts[entry.id] = {
    ...wholePart(order),
    ...(outcome.erpNumber ? { erpNumber: outcome.erpNumber } : {}),
    ...(promises ? { promises } : {}),
    message: outcome.message,
    status: outcome.outcome,
  };
  await writeOrderParts(order.increment_id, record);
  return outcome;
}

function routeOver(params, order, deps, erps) {
  const [first] = erps;
  if (!order?.increment_id) {
    // The save that only wrote an ERP number back: exactly today's send.
    return adapterFor(first).sendPart(
      params,
      { erp: first, lines: linesOf(order), order },
      deps,
    );
  }
  if (erps.length === 1) {
    return routeToOne(params, order, deps, first);
  }
  return routeToSeveral(params, order, deps, erps);
}
