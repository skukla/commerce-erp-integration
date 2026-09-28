/*
 * Blocks per brand (design v1 §3.1, owner 2026-09-27): which ERPs block which Commerce
 * company, and the company's routed orders that are still open, so a block can hold only that
 * ERP's parts of them and an unblock can release them. App Builder State, like the parts
 * record (lib/order-parts.js).
 */
import stateLib from "@adobe/aio-lib-state";

const TTL_SECONDS = 365 * 24 * 60 * 60;

let statePromise;
function state() {
  if (!statePromise) {
    statePromise = stateLib.init();
  }
  return statePromise;
}

/** Test seam. */
export function resetErpBlocksClient(client) {
  statePromise = client ? Promise.resolve(client) : undefined;
}

const safe = (value) => String(value).replace(/[^A-Za-z0-9_-]/gu, "_");
const blocksKey = (companyId) => `erp-blocks-${safe(companyId)}`;
const ordersKey = (companyId) => `company-orders-${safe(companyId)}`;

async function readJson(key, empty) {
  const res = await (await state()).get(key);
  if (!res?.value) {
    return empty;
  }
  try {
    return JSON.parse(res.value);
  } catch {
    return empty;
  }
}

async function writeJson(key, value) {
  await (await state()).put(key, JSON.stringify(value), { ttl: TTL_SECONDS });
}

/** Record whether an ERP blocks a company. */
export async function setBlock(companyId, erpId, blocked) {
  const blocks = await readJson(blocksKey(companyId), {});
  if (blocked) {
    blocks[erpId] = { at: new Date().toISOString() };
  } else {
    delete blocks[erpId];
  }
  await writeJson(blocksKey(companyId), blocks);
}

/** Whether an ERP blocks a company. */
export async function isBlocked(companyId, erpId) {
  const blocks = await readJson(blocksKey(companyId), {});
  return Boolean(blocks[erpId]);
}

/** Remember a routed order of a company, while it is open. */
export async function noteCompanyOrder(companyId, incrementId, orderId) {
  const list = await readJson(ordersKey(companyId), []);
  if (!list.some((o) => o.incrementId === String(incrementId))) {
    list.push({ incrementId: String(incrementId), orderId });
    await writeJson(ordersKey(companyId), list);
  }
}

/** Forget a company's order (it finished). */
export async function forgetCompanyOrder(companyId, incrementId) {
  const list = await readJson(ordersKey(companyId), []);
  await writeJson(
    ordersKey(companyId),
    list.filter((o) => o.incrementId !== String(incrementId)),
  );
}

/** @returns {Promise<{ incrementId: string, orderId: number }[]>} the company's open routed orders */
export function companyOrders(companyId) {
  return readJson(ordersKey(companyId), []);
}
