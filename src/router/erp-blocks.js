/*
 * An ERP's block, per brand (design v1 §3.1, owner 2026-09-27). With several ERPs an ERP's
 * block never changes the Commerce company's own active/blocked flag: it holds only that
 * ERP's parts of the company's open orders, with the reason in each order's history, and the
 * unblock puts them back. A new order's part for a blocking ERP waits the same way (the
 * router checks the block before sending, route-order.js).
 *
 * A part the ERP itself holds (a credit hold) is not the block's to release: only parts marked
 * `heldBy: "block"` are. A part held before it was ever sent is sent when the block lifts.
 */
import { companyOrders, forgetCompanyOrder, setBlock } from "#lib/erp-blocks";
import { erpById } from "#lib/erps";
import { readOrderParts, writeOrderParts } from "#lib/order-parts";

const FINISHED = Object.freeze(["canceled", "closed", "complete"]);

function blockPart(part, erpName) {
  if (part.heldBy === "block") {
    return null;
  }
  return {
    ...part,
    heldBy: "block",
    message: `${erpName} blocks this company; its lines wait until it lifts the block.`,
    ...(part.message === undefined ? {} : { prevMessage: part.message }),
    prevStatus: part.status,
    status: "held",
  };
}

function unblockPart(part) {
  if (part.heldBy !== "block") {
    return null;
  }
  const {
    heldBy: _heldBy,
    message: _message,
    prevMessage,
    prevStatus,
    ...rest
  } = part;
  const message = prevMessage === undefined ? {} : { message: prevMessage };
  return prevStatus
    ? { ...rest, ...message, status: prevStatus }
    : { ...rest, status: "sending" };
}

async function isFinished(params, orderId, deps) {
  if (!deps.getOrderState) {
    return false;
  }
  return FINISHED.includes(await deps.getOrderState(params, orderId));
}

/**
 * Apply one ERP's block or unblock to a company's open orders.
 * @param {object} params action params
 * @param {{ companyId: string, erpId: string, blocked: boolean }} change the ERP's message
 * @param {object} deps `{ erps, addComment, applyCombinedStatus, getOrder, reroute, getOrderState? }`
 * @returns {Promise<{ orders: number }>} how many orders it changed
 */
export async function applyErpBlock(params, change, deps) {
  const { companyId, erpId, blocked } = change;
  const erp = erpById(deps.erps, erpId);
  const name = erp?.name ?? erpId;
  await setBlock(companyId, erpId, blocked);
  let changed = 0;
  for (const { incrementId, orderId } of await companyOrders(companyId)) {
    // biome-ignore lint/performance/noAwaitInLoops: one order at a time, in order
    if (await isFinished(params, orderId, deps)) {
      await forgetCompanyOrder(companyId, incrementId);
      continue;
    }
    const record = await readOrderParts(incrementId);
    const part = record.parts[erpId];
    const next = part && (blocked ? blockPart(part, name) : unblockPart(part));
    if (!next) {
      continue;
    }
    record.parts[erpId] = next;
    await writeOrderParts(incrementId, record);
    changed += 1;
    if (!blocked && next.status === "sending") {
      // Never sent: send it now that the block has lifted.
      await deps.reroute(params, await deps.getOrder(params, incrementId));
    }
    const decision = await deps.applyCombinedStatus(params, orderId, record);
    const words = blocked
      ? next.message
      : `${name} lifted its block on this company; its lines go ahead.`;
    await deps.addComment(params, orderId, {
      statusHistory: {
        comment: decision?.reason ? `${words} (${decision.reason})` : words,
        is_customer_notified: 0,
        is_visible_on_front: 0,
      },
    });
  }
  return { orders: changed };
}
